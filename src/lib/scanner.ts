import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/prisma';

const execAsync = promisify(exec);

// Development mode for Windows/non-Docker environments
const isDevelopmentMode = process.env.NODE_ENV === 'development' && process.platform === 'win32';

import type { ScanRequest, ScanJob } from '@/types';
import { exportDockerImage, inspectDockerImage } from '@/lib/docker';

export interface ScanProgressEvent {
  requestId: string;
  scanId: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  progress: number;
  step?: string;
  error?: string;
  timestamp: string;
}

class ScannerService {
  private jobs = new Map<string, ScanJob>();
  private workDir = process.env.SCANNER_WORKDIR || '/workspace';
  private downloadTimers = new Map<string, NodeJS.Timeout>();
  private scanningTimers = new Map<string, NodeJS.Timeout>();
  private progressListeners = new Set<(event: ScanProgressEvent) => void>();

  async startScan(request: ScanRequest): Promise<{ requestId: string; scanId: string }> {
    const requestId = this.generateRequestId();
    
    console.log(`Starting scan for ${request.image}:${request.tag} with requestId: ${requestId}`);

    // Create initial scan record in database
    const { scanId, imageId } = await this.initializeScanRecord(requestId, request);

    // Track job
    this.jobs.set(requestId, {
      requestId,
      scanId,
      imageId,
      status: 'RUNNING',
      progress: 0
    });

    // Start scan asynchronously
    this.executeScan(requestId, request, scanId, imageId).catch(error => {
      console.error(`Scan ${requestId} failed:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateJobStatus(requestId, 'FAILED', undefined, errorMessage);
    });

    return { requestId, scanId };
  }

  private generateRequestId(): string {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const randomHex = Math.random().toString(16).slice(2, 10);
    return `${timestamp}-${randomHex}`;
  }

  private isLocalDockerScan(request: ScanRequest): boolean {
    return request.source === 'local' && !!request.dockerImageId;
  }

  private async initializeLocalDockerScanRecord(requestId: string, request: ScanRequest) {
    try {
      // Inspect the local Docker image to get metadata
      const imageData = await inspectDockerImage(request.dockerImageId!);
      const digest = imageData.Id; // Use Docker image ID as digest
      
      // Create or find image record
      let image = await prisma.image.findUnique({ where: { digest } });
      
      if (!image) {
        image = await prisma.image.create({
          data: {
            name: request.image,
            tag: request.tag,
            registry: 'local',
            digest,
            platform: `${imageData.Os}/${imageData.Architecture}`,
            sizeBytes: BigInt(imageData.Size || 0),
          }
        });
      }

      // Create scan record
      const scan = await prisma.scan.create({
        data: {
          requestId,
          imageId: image.id,
          startedAt: new Date(),
          status: 'RUNNING',
          source: 'local'
        }
      });

      return { scanId: scan.id, imageId: image.id };
    } catch (error) {
      console.error('Failed to initialize local Docker scan record:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to inspect local Docker image ${request.dockerImageId}: ${errorMessage}`);
    }
  }

  private async initializeScanRecord(requestId: string, request: ScanRequest) {
    if (isDevelopmentMode) {
      // Skip Docker inspection in development mode - create mock image and scan records
      const mockDigest = `sha256:${Math.random().toString(16).slice(2, 66)}`;
      
      // Find or create image record
      let image = await prisma.image.findFirst({
        where: {
          name: request.image,
          tag: request.tag,
          registry: request.registry,
        }
      });

      if (!image) {
        image = await prisma.image.create({
          data: {
            name: request.image,
            tag: request.tag,
            registry: request.registry,
            digest: mockDigest,
            platform: 'linux/amd64',
            sizeBytes: BigInt(134217728), // 128MB mock size
          }
        });
      }

      // Create scan record
      const scan = await prisma.scan.create({
        data: {
          requestId,
          imageId: image.id,
          startedAt: new Date(),
          status: 'RUNNING',
          source: request.source || 'registry'
        }
      });

      return { scanId: scan.id, imageId: image.id };
    }

    // Handle local Docker images vs registry images
    if (this.isLocalDockerScan(request)) {
      return this.initializeLocalDockerScanRecord(requestId, request);
    }

    // Resolve image digest to get unique identifier
    const fullImageName = request.registry ? `${request.registry}/${request.image}` : request.image;
    const imageRef = `${fullImageName}:${request.tag}`;

    try {
      // Get image digest using skopeo
      const { stdout: digestOutput } = await execAsync(
        `skopeo inspect --format '{{.Digest}}' docker://${imageRef}`
      );
      const digest = digestOutput.trim();

      // Create or find image record
      let image = await prisma.image.findUnique({ where: { digest } });
      
      if (!image) {
        // Get additional metadata
        const { stdout: metadataOutput } = await execAsync(
          `skopeo inspect docker://${imageRef}`
        );
        const metadata = JSON.parse(metadataOutput);

        image = await prisma.image.create({
          data: {
            name: request.image,
            tag: request.tag,
            registry: request.registry,
            digest,
            platform: `${metadata.Os}/${metadata.Architecture}`,
            sizeBytes: BigInt(metadata.Size || 0),
          }
        });
      }

      // Create scan record
      const scan = await prisma.scan.create({
        data: {
          requestId,
          imageId: image.id,
          startedAt: new Date(),
          status: 'RUNNING',
          source: request.source || 'registry'
        }
      });

      return { scanId: scan.id, imageId: image.id };
    } catch (error) {
      console.error('Failed to initialize scan record:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to inspect image ${imageRef}: ${errorMessage}`);
    }
  }

  private async executeScan(requestId: string, request: ScanRequest, scanId: string, imageId: string) {
    if (isDevelopmentMode) {
      // Development mode: simulate scan with mock data
      return this.executeMockScan(requestId, request, scanId, imageId);
    }

    const reportDir = path.join(this.workDir, 'reports', requestId);
    const imageDir = path.join(this.workDir, 'images');
    const cacheDir = path.join(this.workDir, 'cache');

    try {
      // Create directories
      await fs.mkdir(reportDir, { recursive: true });
      await fs.mkdir(imageDir, { recursive: true });
      await fs.mkdir(path.join(cacheDir, 'trivy'), { recursive: true });
      await fs.mkdir(path.join(cacheDir, 'grype'), { recursive: true });
      await fs.mkdir(path.join(cacheDir, 'syft'), { recursive: true });
      await fs.mkdir(path.join(cacheDir, 'dockle'), { recursive: true });

      this.updateJobStatus(requestId, 'RUNNING', 10, undefined, 'Setting up scan environment');

      // Execute scanning script (local or registry)
      if (this.isLocalDockerScan(request)) {
        await this.runLocalDockerScan(requestId, request, reportDir, imageDir, cacheDir);
      } else {
        await this.runScanScript(requestId, request, reportDir, imageDir, cacheDir);
      }

      this.updateJobStatus(requestId, 'RUNNING', 90, undefined, 'Processing scan results');

      // Upload results to database
      await this.uploadScanResults(requestId, scanId, reportDir, request);

      this.updateJobStatus(requestId, 'SUCCESS', 100, undefined, 'Scan completed successfully');

    } catch (error) {
      console.error(`Scan execution failed for ${requestId}:`, error);
      
      // Clean up timers
      const downloadTimer = this.downloadTimers.get(requestId);
      if (downloadTimer) {
        clearInterval(downloadTimer);
        this.downloadTimers.delete(requestId);
      }
      const scanningTimer = this.scanningTimers.get(requestId);
      if (scanningTimer) {
        clearInterval(scanningTimer);
        this.scanningTimers.delete(requestId);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateScanRecord(scanId, {
        status: 'FAILED',
        errorMessage,
        finishedAt: new Date()
      });
      this.updateJobStatus(requestId, 'FAILED', undefined, errorMessage);
      throw error;
    }
  }

  private async executeMockScan(requestId: string, request: ScanRequest, scanId: string, imageId: string) {
    console.log(`Development mode: mocking scan for ${request.image}:${request.tag}`);
    
    try {
      this.updateJobStatus(requestId, 'RUNNING', 25, undefined, 'Preparing mock scan data');
      
      // Simulate scan time
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.updateJobStatus(requestId, 'RUNNING', 50, undefined, 'Running vulnerability analysis');
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.updateJobStatus(requestId, 'RUNNING', 75, undefined, 'Generating compliance report');
      
      // Generate mock scan data based on existing report
      const mockReports = await this.generateMockScanData(request);
      
      // Upload mock results to database
      await this.uploadMockScanResults(requestId, scanId, mockReports, request);
      
      this.updateJobStatus(requestId, 'SUCCESS', 100, undefined, 'Mock scan completed successfully');
      
    } catch (error) {
      console.error(`Mock scan failed for ${requestId}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateScanRecord(scanId, {
        status: 'FAILED',
        errorMessage,
        finishedAt: new Date()
      });
      this.updateJobStatus(requestId, 'FAILED', undefined, errorMessage);
      throw error;
    }
  }

  private async runLocalDockerScan(
    requestId: string,
    request: ScanRequest,
    reportDir: string,
    imageDir: string,
    cacheDir: string
  ) {
    const imageName = request.dockerImageId!;
    const safeImageName = request.image.replace(/\//g, '_');
    const tarPath = path.join(imageDir, `${safeImageName}-${requestId}.tar`);

    // Set environment variables for caching
    const env = {
      ...process.env,
      TRIVY_CACHE_DIR: path.join(cacheDir, 'trivy'),
      GRYPE_DB_CACHE_DIR: path.join(cacheDir, 'grype'),
      SYFT_CACHE_DIR: path.join(cacheDir, 'syft'),
      DOCKLE_TMP_DIR: path.join(cacheDir, 'dockle'),
    };

    console.log(`Scanning local Docker image ${imageName}`);

    this.updateJobStatus(requestId, 'RUNNING', 20, undefined, 'Exporting Docker image');

    // 1. Export Docker image to tar
    await exportDockerImage(imageName, tarPath);
    
    this.updateJobStatus(requestId, 'RUNNING', 50, undefined, 'Image export completed');

    // 2. Get metadata using docker inspect
    const imageData = await inspectDockerImage(imageName);
    await fs.writeFile(path.join(reportDir, 'metadata.json'), JSON.stringify(imageData, null, 2));

    // 3. Continue with the same scanning process as registry images
    await this.runScannersOnTar(requestId, tarPath, reportDir, env);

    // Clean up tar file to save space
    try {
      await fs.unlink(tarPath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Failed to cleanup tar file:', errorMessage);
    }
  }

  private async runScanScript(
    requestId: string,
    request: ScanRequest,
    reportDir: string,
    imageDir: string,
    cacheDir: string
  ) {
    const fullImageName = request.registry ? `${request.registry}/${request.image}` : request.image;
    const imageRef = `${fullImageName}:${request.tag}`;

    // Set environment variables for caching
    const env = {
      ...process.env,
      TRIVY_CACHE_DIR: path.join(cacheDir, 'trivy'),
      GRYPE_DB_CACHE_DIR: path.join(cacheDir, 'grype'),
      SYFT_CACHE_DIR: path.join(cacheDir, 'syft'),
      DOCKLE_TMP_DIR: path.join(cacheDir, 'dockle'),
    };

    // Get image digest and create tar path
    const { stdout: digestOutput } = await execAsync(
      `skopeo inspect --format '{{.Digest}}' docker://${imageRef}`,
      { env }
    );
    const digest = digestOutput.trim();
    const imageHash = digest.replace('sha256:', '');
    const safeImageName = request.image.replace(/\//g, '_');
    const tarPath = path.join(imageDir, `${safeImageName}-${imageHash}.tar`);

    console.log(`Scanning ${imageRef} (${digest})`);

    // Start progressive download simulation
    this.simulateDownloadProgress(requestId);

    this.updateJobStatus(requestId, 'RUNNING', 1, undefined, 'Starting image download');

    // 1. Download image as tar
    console.log(`skopeo copy docker://${imageRef} docker-archive:${tarPath}`)
    await execAsync(`skopeo copy docker://${imageRef} docker-archive:${tarPath}`, { env });
    
    // Clear download timer and ensure we're at least at 50%
    const downloadTimer = this.downloadTimers.get(requestId);
    if (downloadTimer) {
      clearInterval(downloadTimer);
      this.downloadTimers.delete(requestId);
    }
    
    const job = this.jobs.get(requestId);
    const currentProgress = job ? (job.progress || 0) : 0;
    const nextProgress = Math.max(currentProgress, 50);
    
    this.updateJobStatus(requestId, 'RUNNING', nextProgress, undefined, 'Image download completed');

    // 2. Get metadata
    const { stdout: metadataOutput } = await execAsync(
      `skopeo inspect docker-archive:${tarPath}`,
      { env }
    );
    await fs.writeFile(path.join(reportDir, 'metadata.json'), metadataOutput);

    this.updateJobStatus(requestId, 'RUNNING', 55, undefined, 'Starting security scans');
    
    // Start scanning progress simulation
    this.simulateScanningProgress(requestId);

    // 3. Run Trivy
    try {
      await execAsync(
        `trivy image --input "${tarPath}" -f json -o "${path.join(reportDir, 'trivy.json')}"`,
        { env, timeout: 300000 } // 5 minute timeout
      );
      this.updateJobStatus(requestId, 'RUNNING', 65, undefined, 'Trivy vulnerability scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Trivy scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'trivy.json'), JSON.stringify({ error: errorMessage }));
    }

    // 4. Run Grype
    try {
      await execAsync(
        `grype docker-archive:${tarPath} -o json > "${path.join(reportDir, 'grype.json')}"`,
        { env, shell: '/bin/sh', timeout: 300000 }
      );
      this.updateJobStatus(requestId, 'RUNNING', 75, undefined, 'Grype vulnerability scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Grype scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'grype.json'), JSON.stringify({ error: errorMessage }));
    }

    // 5. Run Syft (generate both JSON and CycloneDX formats)
    try {
      // Generate regular JSON SBOM
      await execAsync(
        `syft docker-archive:${tarPath} -o json > "${path.join(reportDir, 'syft.json')}"`,
        { env, shell: '/bin/sh', timeout: 300000 }
      );
      console.log(`syft docker-archive:${tarPath} -o cyclonedx-json@1.5 > "${path.join(reportDir, 'sbom.cdx.json')}"`)
      // Generate CycloneDX JSON SBOM for OSV Scanner
      await execAsync(
        `syft docker-archive:${tarPath} -o cyclonedx-json@1.5 > "${path.join(reportDir, 'sbom.cdx.json')}"`,
        { env, shell: '/bin/sh', timeout: 300000 }
      );
      
      this.updateJobStatus(requestId, 'RUNNING', 85, undefined, 'Syft SBOM generation completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Syft scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'syft.json'), JSON.stringify({ error: errorMessage }));
    }

    // 6. Run OSV Scanner
    try {
      const sbomPath = path.join(reportDir, 'sbom.cdx.json');
      const osvOutput = path.join(reportDir, 'osv.json');
      
      console.log(`Running OSV scanner: osv-scanner -L "${sbomPath}" --verbosity error --format json`);
      
      // OSV scanner may return exit code 1 even when successful if vulnerabilities are found
      // Use try-catch with ignore-errors approach
      try {
        await execAsync(
          `osv-scanner -L "${sbomPath}" --verbosity error --format json > "${osvOutput}"`,
          { env, shell: '/bin/sh', timeout: 300000, maxBuffer: 10 * 1024 * 1024 * 10 }
        );
      } catch (osvError: any) {
        // Check if output file was created despite the error
        try {
          await fs.access(osvOutput);
          console.log('OSV scanner completed with vulnerabilities found (exit code 1 is normal)');
        } catch {
          // No output file, this is a real error
          throw osvError;
        }
      }
      
      this.updateJobStatus(requestId, 'RUNNING', 88, undefined, 'OSV vulnerability scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('OSV scan failed with detailed error:', error);
      console.warn('OSV scan failed:', errorMessage);
      
      // Create empty results file so the scan can continue
      await fs.writeFile(path.join(reportDir, 'osv.json'), JSON.stringify({ 
        error: errorMessage,
        vulnerabilities: []
      }));
    }

    // 7. Run Dockle
    try {
      await execAsync(
        `dockle --input "${tarPath}" --format json --output "${path.join(reportDir, 'dockle.json')}"`,
        { env, timeout: 180000 } // 3 minute timeout
      );
      this.updateJobStatus(requestId, 'RUNNING', 90, undefined, 'Dockle compliance scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Dockle scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'dockle.json'), JSON.stringify({ error: errorMessage }));
    }

    // 8. Run Dive
    try {
      const diveOutput = path.join(reportDir, 'dive.json');
      console.log(`Running Dive analysis: dive docker-archive:${tarPath} --json ${diveOutput}`);
      
      await execAsync(
        `dive --source docker-archive ${tarPath} --json ${diveOutput}`,
        { env, timeout: 240000 } // 4 minute timeout (Dive can be slower)
      );
      this.updateJobStatus(requestId, 'RUNNING', 94, undefined, 'Dive layer analysis completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Dive scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'dive.json'), JSON.stringify({ 
        error: errorMessage,
        layer: [] 
      }));
    }

    // Clean up tar file to save space
    try {
      await fs.unlink(tarPath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Failed to cleanup tar file:', errorMessage);
    }
  }

  private async runScannersOnTar(
    requestId: string,
    tarPath: string,
    reportDir: string,
    env: NodeJS.ProcessEnv
  ) {
    this.updateJobStatus(requestId, 'RUNNING', 55, undefined, 'Starting security scans');
    
    // Start scanning progress simulation
    this.simulateScanningProgress(requestId);

    // 1. Run Trivy
    try {
      await execAsync(
        `trivy image --input "${tarPath}" -f json -o "${path.join(reportDir, 'trivy.json')}"`,
        { env, timeout: 300000 } // 5 minute timeout
      );
      this.updateJobStatus(requestId, 'RUNNING', 65, undefined, 'Trivy vulnerability scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Trivy scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'trivy.json'), JSON.stringify({ error: errorMessage }));
    }

    // 2. Run Grype
    try {
      await execAsync(
        `grype docker-archive:${tarPath} -o json > "${path.join(reportDir, 'grype.json')}"`,
        { env, shell: '/bin/sh', timeout: 300000 }
      );
      this.updateJobStatus(requestId, 'RUNNING', 75, undefined, 'Grype vulnerability scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Grype scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'grype.json'), JSON.stringify({ error: errorMessage }));
    }

    // 3. Run Syft (generate both JSON and CycloneDX formats)
    try {
      // Generate regular JSON SBOM
      await execAsync(
        `syft docker-archive:${tarPath} -o json > "${path.join(reportDir, 'syft.json')}"`,
        { env, shell: '/bin/sh', timeout: 300000 }
      );
      // Generate CycloneDX JSON SBOM for OSV Scanner
      await execAsync(
        `syft docker-archive:${tarPath} -o cyclonedx-json@1.5 > "${path.join(reportDir, 'sbom.cdx.json')}"`,
        { env, shell: '/bin/sh', timeout: 300000 }
      );
      
      this.updateJobStatus(requestId, 'RUNNING', 85, undefined, 'Syft SBOM generation completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Syft scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'syft.json'), JSON.stringify({ error: errorMessage }));
    }

    // 4. Run OSV Scanner
    try {
      const sbomPath = path.join(reportDir, 'sbom.cdx.json');
      const osvOutput = path.join(reportDir, 'osv.json');
      
      // OSV scanner may return exit code 1 even when successful if vulnerabilities are found
      try {
        await execAsync(
          `osv-scanner -L "${sbomPath}" --verbosity error --format json > "${osvOutput}"`,
          { env, shell: '/bin/sh', timeout: 300000, maxBuffer: 10 * 1024 * 1024 * 10 }
        );
      } catch (osvError: any) {
        // Check if output file was created despite the error
        try {
          await fs.access(osvOutput);
          console.log('OSV scanner completed with vulnerabilities found (exit code 1 is normal)');
        } catch {
          // No output file, this is a real error
          throw osvError;
        }
      }
      
      this.updateJobStatus(requestId, 'RUNNING', 88, undefined, 'OSV vulnerability scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('OSV scan failed with detailed error:', error);
      console.warn('OSV scan failed:', errorMessage);
      
      // Create empty results file so the scan can continue
      await fs.writeFile(path.join(reportDir, 'osv.json'), JSON.stringify({ 
        error: errorMessage,
        vulnerabilities: []
      }));
    }

    // 5. Run Dockle
    try {
      await execAsync(
        `dockle --input "${tarPath}" --format json --output "${path.join(reportDir, 'dockle.json')}"`,
        { env, timeout: 180000 } // 3 minute timeout
      );
      this.updateJobStatus(requestId, 'RUNNING', 90, undefined, 'Dockle compliance scan completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Dockle scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'dockle.json'), JSON.stringify({ error: errorMessage }));
    }

    // 6. Run Dive
    try {
      const diveOutput = path.join(reportDir, 'dive.json');
      
      await execAsync(
        `dive --source docker-archive ${tarPath} --json ${diveOutput}`,
        { env, timeout: 240000 } // 4 minute timeout
      );
      this.updateJobStatus(requestId, 'RUNNING', 94, undefined, 'Dive layer analysis completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('Dive scan failed:', errorMessage);
      await fs.writeFile(path.join(reportDir, 'dive.json'), JSON.stringify({ 
        error: errorMessage,
        layer: [] 
      }));
    }
  }

  private async uploadScanResults(requestId: string, scanId: string, reportDir: string, request: ScanRequest) {
    const reports: any = {};
    
    // Read all report files
    const reportFiles = ['trivy.json', 'grype.json', 'syft.json', 'dockle.json', 'osv.json', 'dive.json', 'metadata.json'];
    
    for (const filename of reportFiles) {
      const filePath = path.join(reportDir, filename);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const reportName = filename.replace('.json', '');
        reports[reportName] = JSON.parse(content);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to read ${filename}:`, errorMessage);
      }
    }

    // Update scan record with results
    await this.updateScanRecord(scanId, {
      status: 'SUCCESS',
      finishedAt: new Date(),
      reportsDir: reportDir,
      trivy: reports.trivy as any,
      grype: reports.grype as any,
      syft: reports.syft as any,
      dockle: reports.dockle as any,
      osv: reports.osv as any,
      dive: reports.dive as any,
      metadata: reports.metadata as any,
      scannerVersions: await this.getScannerVersions() as any,
    });

    // Calculate and store aggregated data
    await this.calculateAggregatedData(scanId, reports);
  }

  private async updateScanRecord(scanId: string, updates: any) {
    await prisma.scan.update({
      where: { id: scanId },
      data: updates
    });
  }

  private async getScannerVersions() {
    const versions: Record<string, string> = {};
    
    const scanners = [
      { name: 'trivy', command: 'trivy --version' },
      { name: 'grype', command: 'grype version' },
      { name: 'syft', command: 'syft version' },
      { name: 'dockle', command: 'dockle --version' },
      { name: 'dive', command: 'dive --version' },
    ];

    for (const scanner of scanners) {
      try {
        const { stdout } = await execAsync(scanner.command);
        versions[scanner.name] = stdout.trim().split('\n')[0];
      } catch (error) {
        versions[scanner.name] = 'unknown';
      }
    }

    return versions;
  }

  private async calculateAggregatedData(scanId: string, reports: any) {
    const aggregates: any = {};

    // Process Trivy vulnerabilities
    if (reports.trivy?.Results) {
      const vulnCount = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      let totalCvssScore = 0;
      let cvssCount = 0;

      for (const result of reports.trivy.Results) {
        if (result.Vulnerabilities) {
          for (const vuln of result.Vulnerabilities) {
            const severity = vuln.Severity?.toLowerCase();
            if (severity && vulnCount.hasOwnProperty(severity)) {
              vulnCount[severity as keyof typeof vulnCount]++;
            }
            
            // Extract CVSS score
            if (vuln.CVSS?.redhat?.V3Score || vuln.CVSS?.nvd?.V3Score) {
              const score = vuln.CVSS.redhat?.V3Score || vuln.CVSS.nvd?.V3Score;
              totalCvssScore += score;
              cvssCount++;
            }
          }
        }
      }

      aggregates.vulnerabilityCount = vulnCount;
      
      // Calculate risk score
      const avgCvss = cvssCount > 0 ? totalCvssScore / cvssCount : 0;
      aggregates.riskScore = Math.min(100, Math.round(
        (vulnCount.critical * 25) +
        (vulnCount.high * 10) +
        (vulnCount.medium * 3) +
        (vulnCount.low * 1) +
        (avgCvss * 5)
      ));
    }

    // Process Dockle compliance
    if (reports.dockle?.summary) {
      const { fatal, warn, info, pass } = reports.dockle.summary;
      const total = fatal + warn + info + pass;
      const complianceScore = total > 0 ? Math.round((pass / total) * 100) : 0;
      
      aggregates.complianceScore = {
        dockle: {
          score: complianceScore,
          grade: complianceScore >= 90 ? 'A' : complianceScore >= 80 ? 'B' : complianceScore >= 70 ? 'C' : 'D',
          fatal,
          warn,
          info,
          pass,
        }
      };
    }

    // Update scan with aggregated data
    if (Object.keys(aggregates).length > 0) {
      await this.updateScanRecord(scanId, aggregates);
    }
  }

  private updateJobStatus(requestId: string, status: ScanJob['status'], progress?: number, error?: string, step?: string) {
    const job = this.jobs.get(requestId);
    if (job) {
      job.status = status;
      if (progress !== undefined) job.progress = progress;
      if (error) job.error = error;
      this.jobs.set(requestId, job);

      // Emit SSE event for real-time updates (only for supported statuses)
      if (status === 'RUNNING' || status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED') {
        const progressEvent: ScanProgressEvent = {
          requestId,
          scanId: job.scanId,
          status,
          progress: progress !== undefined ? progress : (job.progress || 0),
          step,
          error,
          timestamp: new Date().toISOString()
        };

        this.emitProgress(progressEvent);
      }
    }
  }

  private simulateDownloadProgress(requestId: string) {
    const startTime = Date.now();
    const duration = 55000; // 55 seconds to reach 55%
    const maxProgress = 55; // Max 55% for download phase
    const updateInterval = 3000; // Update every second

    // Clear any existing timer for this request
    const existingTimer = this.downloadTimers.get(requestId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const job = this.jobs.get(requestId);
      
      // Stop if job doesn't exist or is no longer running
      if (!job || job.status !== 'RUNNING') {
        clearInterval(timer);
        this.downloadTimers.delete(requestId);
        return;
      }

      // Calculate progress (1% to 55% over 55 seconds = ~1% per second)
      const timeProgress = Math.min(elapsed / duration, 1);
      const currentProgress = 1 + (timeProgress * (maxProgress - 1));
      
      // Only update if current job progress is still in download range (< 56%)
      if ((job.progress || 0) < 56) {
        let step: string;
        if (currentProgress < 10) {
          step = 'Connecting to registry';
        } else if (currentProgress < 25) {
          step = 'Downloading image layers';
        } else if (currentProgress < 40) {
          step = 'Extracting image data';
        } else if (currentProgress < 55) {
          step = 'Finalizing image download';
        } else {
          step = 'Preparing for scan';
        }

        this.updateJobStatus(requestId, 'RUNNING', Math.floor(currentProgress), undefined, step);
      }

      // Stop timer after 55 seconds or if we've moved past download phase
      if (elapsed >= duration || (job.progress || 0) >= 56) {
        clearInterval(timer);
        this.downloadTimers.delete(requestId);
      }
    }, updateInterval);

    this.downloadTimers.set(requestId, timer);
  }

  private simulateScanningProgress(requestId: string) {
    const startTime = Date.now();
    const updateInterval = 3000; // Update every second (1%)

    // Clear any existing scanning timer for this request
    const existingTimer = this.scanningTimers.get(requestId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    const timer = setInterval(() => {
      const job = this.jobs.get(requestId);
      
      // Stop if job doesn't exist or is no longer running
      if (!job || job.status !== 'RUNNING') {
        clearInterval(timer);
        this.scanningTimers.delete(requestId);
        return;
      }

      const currentProgress = job.progress || 0;
      
      // Only increment if we're in scanning phase (>= 55%) and haven't reached 95%
      if (currentProgress >= 55 && currentProgress < 95) {
        const newProgress = currentProgress + 1;
        
        let step: string = job.step || 'Running security scans';
        if (currentProgress < 65) {
          step = 'Running Trivy scan';
        } else if (currentProgress < 75) {
          step = 'Running Grype scan';
        } else if (currentProgress < 85) {
          step = 'Running Syft analysis';
        } else if (currentProgress < 88) {
          step = 'Running OSV scan';
        } else if (currentProgress < 92) {
          step = 'Running Dockle compliance check';
        } else if (currentProgress < 95) {
          step = 'Running Dive layer analysis';
        } else {
          step = 'Finalizing scan results';
        }
        
        this.updateJobStatus(requestId, 'RUNNING', newProgress, undefined, step);
      }

      // Stop if we've reached 95% (let actual completion take over)
      if (currentProgress >= 95) {
        clearInterval(timer);
        this.scanningTimers.delete(requestId);
      }
    }, updateInterval);

    this.scanningTimers.set(requestId, timer);
  }

  getScanJob(requestId: string): ScanJob | undefined {
    return this.jobs.get(requestId);
  }

  getAllJobs(): ScanJob[] {
    return Array.from(this.jobs.values());
  }

  // SSE Progress Management
  addProgressListener(listener: (event: ScanProgressEvent) => void) {
    this.progressListeners.add(listener);
  }

  removeProgressListener(listener: (event: ScanProgressEvent) => void) {
    this.progressListeners.delete(listener);
  }

  private emitProgress(event: ScanProgressEvent) {
    this.progressListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in progress listener:', error);
      }
    });
  }

  async cancelScan(requestId: string): Promise<boolean> {
    const job = this.jobs.get(requestId);
    if (job && job.status === 'RUNNING') {
      // Clean up timers
      const downloadTimer = this.downloadTimers.get(requestId);
      if (downloadTimer) {
        clearInterval(downloadTimer);
        this.downloadTimers.delete(requestId);
      }
      const scanningTimer = this.scanningTimers.get(requestId);
      if (scanningTimer) {
        clearInterval(scanningTimer);
        this.scanningTimers.delete(requestId);
      }

      this.updateJobStatus(requestId, 'CANCELLED');
      
      // Update database
      await this.updateScanRecord(job.scanId, {
        status: 'CANCELLED',
        finishedAt: new Date()
      });
      
      return true;
    }
    return false;
  }

  private async generateMockScanData(request: ScanRequest) {
    // Use existing scan data as template and modify for the requested image
    const templatePath = path.join(process.cwd(), 'reports');
    
    try {
      // Try to read existing scan data from reports directory
      const existingReports = await fs.readdir(templatePath);
      if (existingReports.length > 0) {
        const reportDir = path.join(templatePath, existingReports[0]);
        return await this.loadExistingScanData(reportDir, request);
      }
    } catch {
      // Reports directory doesn't exist, use hardcoded mock
    }

    // Fallback to basic mock data
    return this.generateBasicMockData(request);
  }

  private async loadExistingScanData(reportDir: string, request: ScanRequest) {
    const mockReports: any = {};

    try {
      // Load trivy report and modify image name
      const trivyPath = path.join(reportDir, 'trivy-results.json');
      const trivyData = JSON.parse(await fs.readFile(trivyPath, 'utf8'));
      trivyData.ArtifactName = `${request.image}:${request.tag}`;
      mockReports.trivy = trivyData;
    } catch {
      mockReports.trivy = this.generateMockTrivyData(request);
    }

    try {
      // Load dockle report
      const docklePath = path.join(reportDir, 'dockle-results.json');
      mockReports.dockle = JSON.parse(await fs.readFile(docklePath, 'utf8'));
    } catch {
      mockReports.dockle = this.generateMockDockleData();
    }

    return mockReports;
  }

  private generateBasicMockData(request: ScanRequest) {
    return {
      trivy: this.generateMockTrivyData(request),
      dockle: this.generateMockDockleData(),
      grype: null,
      syft: null,
    };
  }

  private generateMockTrivyData(request: ScanRequest) {
    return {
      SchemaVersion: 2,
      CreatedAt: new Date().toISOString(),
      ArtifactName: `${request.image}:${request.tag}`,
      ArtifactType: "container_image",
      Metadata: {
        OS: {
          Family: "debian",
          Name: "12.11"
        },
        ImageID: `sha256:${Math.random().toString(16).slice(2, 66)}`,
      },
      Results: [
        {
          Target: `${request.image}:${request.tag} (debian 12.11)`,
          Class: "os-pkgs",
          Type: "debian",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2024-MOCK",
              PkgName: "mock-package",
              InstalledVersion: "1.0.0",
              Severity: Math.random() > 0.7 ? "HIGH" : Math.random() > 0.5 ? "MEDIUM" : "LOW",
              Title: "Mock vulnerability for development",
              Description: `Mock vulnerability found in ${request.image}:${request.tag}`,
            }
          ]
        }
      ]
    };
  }

  private generateMockDockleData() {
    return {
      summary: {
        fatal: Math.floor(Math.random() * 3),
        warn: Math.floor(Math.random() * 5),
        info: Math.floor(Math.random() * 10),
        pass: Math.floor(Math.random() * 20) + 10,
      },
      details: []
    };
  }

  private async uploadMockScanResults(requestId: string, scanId: string, mockReports: any, request: ScanRequest) {
    console.log(`Uploading mock scan results for ${requestId}`);

    // Update scan record with mock data
    await this.updateScanRecord(scanId, {
      trivy: mockReports.trivy || null,
      grype: mockReports.grype || null,
      syft: mockReports.syft || null,
      dockle: mockReports.dockle || null,
      status: 'SUCCESS',
      finishedAt: new Date()
    });

    console.log(`Mock scan results uploaded for ${requestId}`);
  }
}

export const scannerService = new ScannerService();