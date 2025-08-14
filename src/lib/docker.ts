import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  digest: string;
  size: string;
  created: string;
  fullName: string;
}

export interface DockerInfo {
  hasAccess: boolean;
  version?: string;
  error?: string;
}

/**
 * Check if Docker socket is accessible and Docker daemon is running
 */
export async function checkDockerAccess(): Promise<DockerInfo> {
  try {
    const { stdout } = await execAsync('docker version --format "{{.Client.Version}}"', {
      timeout: 5000
    });
    
    return {
      hasAccess: true,
      version: stdout.trim()
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      hasAccess: false,
      error: errorMessage
    };
  }
}

/**
 * List all Docker images available locally
 */
export async function listDockerImages(): Promise<DockerImage[]> {
  try {
    const { stdout } = await execAsync(
      'docker images --format "{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Digest}}\t{{.Size}}\t{{.CreatedAt}}"',
      { timeout: 10000 }
    );

    const lines = stdout.trim().split('\n').filter(line => line.length > 0);
    
    return lines.map(line => {
      const [id, repository, tag, digest, size, created] = line.split('\t');
      return {
        id: id.substring(0, 12), // Short ID
        repository: repository || '<none>',
        tag: tag || '<none>',
        digest: digest || '<none>',
        size,
        created,
        fullName: repository === '<none>' || tag === '<none>' 
          ? id 
          : `${repository}:${tag}`
      };
    }).filter(image => 
      // Filter out <none> images and dangling images
      image.repository !== '<none>' && image.tag !== '<none>'
    );
  } catch (error) {
    console.error('Failed to list Docker images:', error);
    throw new Error(`Failed to list Docker images: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Export a Docker image to a tar file
 */
export async function exportDockerImage(imageName: string, outputPath: string): Promise<void> {
  try {
    await execAsync(
      `docker save "${imageName}" -o "${outputPath}"`,
      { timeout: 300000 } // 5 minute timeout for large images
    );
  } catch (error) {
    console.error(`Failed to export Docker image ${imageName}:`, error);
    throw new Error(`Failed to export Docker image: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get detailed information about a specific Docker image
 */
export async function inspectDockerImage(imageName: string): Promise<any> {
  try {
    const { stdout } = await execAsync(
      `docker inspect "${imageName}"`,
      { timeout: 10000 }
    );
    
    const imageData = JSON.parse(stdout);
    return imageData[0]; // docker inspect returns an array
  } catch (error) {
    console.error(`Failed to inspect Docker image ${imageName}:`, error);
    throw new Error(`Failed to inspect Docker image: ${error instanceof Error ? error.message : String(error)}`);
  }
}