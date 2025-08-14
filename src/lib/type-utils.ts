// Utility functions to convert between Prisma types and UI types
// This provides a clean migration path from legacy types to Prisma types

import type { 
  Scan as PrismaScan,
  Image as PrismaImage 
} from '@/generated/prisma';
import type { 
  Scan,
  ScanWithImage,
  LegacyScan,
  VulnerabilityCount,
  ComplianceScore 
} from '@/types';

/**
 * Convert Prisma Scan to UI Scan (handling BigInt serialization)
 */
export function prismaToScan(prismaData: PrismaScan & { image?: PrismaImage }): Scan {
  const { sizeBytes, ...rest } = prismaData;
  
  return {
    ...rest,
    sizeBytes: sizeBytes ? sizeBytes.toString() : null,
  } as Scan;
}

/**
 * Convert Prisma Scan with Image relation to ScanWithImage
 */
export function prismaToScanWithImage(prismaData: PrismaScan & { image: PrismaImage }): ScanWithImage {
  const scan = prismaToScan(prismaData);
  return {
    ...scan,
    image: prismaData.image,
    // Transform scanner reports from separate JSON fields to nested object
    scannerReports: {
      trivy: prismaData.trivy as any,
      grype: prismaData.grype as any,
      syft: prismaData.syft as any,
      dockle: prismaData.dockle as any,
      osv: prismaData.osv as any,
      dive: prismaData.dive as any,
      metadata: prismaData.metadata as any,
    } as any,
  };
}

/**
 * Convert modern Scan to Legacy Scan format for UI compatibility
 */
export function scanToLegacyScan(scan: ScanWithImage): LegacyScan {
  // Extract vulnerability counts from the scan
  const vulnCount = scan.vulnerabilityCount as VulnerabilityCount | undefined;
  const complianceScore = scan.complianceScore as ComplianceScore | undefined;
  
  return {
    // Map new fields to legacy fields
    id: parseInt(scan.id.slice(-8), 16), // Convert cuid to number-like ID
    uid: scan.requestId,
    image: scan.image?.name || 'unknown',
    digestShort: scan.image?.digest?.slice(7, 19) || '', // First 12 chars after "sha256:"
    platform: scan.image?.platform || 'unknown',
    sizeMb: scan.sizeBytes ? Math.round(parseInt(scan.sizeBytes) / 1024 / 1024) : 0,
    riskScore: scan.riskScore || 0,
    
    // Map vulnerability counts
    severities: {
      crit: vulnCount?.critical || 0,
      high: vulnCount?.high || 0,
      med: vulnCount?.medium || 0,
      low: vulnCount?.low || 0,
    },
    
    // Calculate fixable vulnerabilities (placeholder logic)
    fixable: {
      count: Math.floor((vulnCount?.critical || 0) * 0.7 + (vulnCount?.high || 0) * 0.5),
      percent: vulnCount ? Math.round(
        ((vulnCount.critical + vulnCount.high) * 0.6 / 
         (vulnCount.critical + vulnCount.high + vulnCount.medium + vulnCount.low)) * 100
      ) || 0 : 0
    },
    
    highestCvss: 0, // Would need to extract from scanner reports
    misconfigs: 0, // Would need to extract from scanner reports  
    secrets: 0, // Would need to extract from scanner reports
    
    // Map compliance scores
    compliance: {
      dockle: complianceScore?.dockle?.grade,
    },
    
    policy: "Pass", // Default placeholder
    
    delta: {
      newCrit: 0,
      resolvedTotal: 0
    },
    
    inUse: {
      clusters: 0,
      pods: 0
    },
    
    baseImage: extractBaseImage(scan.image?.name),
    baseUpdate: undefined,
    signed: false,
    imageId: scan.imageId, // or derive from scan
    imageName: extractBaseImage(scan.image?.name) || "",
    attested: false,
    sbomFormat: "spdx",
    dbAge: "0h",
    registry: scan.image?.registry || undefined,
    project: undefined,
    lastScan: typeof scan.finishedAt === 'string' ? scan.finishedAt : scan.finishedAt?.toISOString() || (typeof scan.createdAt === 'string' ? scan.createdAt : scan.createdAt.toISOString()),
    status: mapScanStatus(scan.status),
    header: undefined,
    type: undefined,
    target: undefined,
    limit: undefined,
    
    // Pass through scanner reports
    scannerReports: scan.scannerReports,
    
    // Additional fields
    digest: scan.image?.digest,
    layers: scan.image?.digest ? [] : undefined, // Would need to extract from metadata
    osInfo: extractOsInfo(scan),
  };
}

/**
 * Convert array of Prisma scans to legacy scans
 */
export function scansToLegacyScans(scans: ScanWithImage[]): LegacyScan[] {
  return scans.map(scanToLegacyScan);
}

/**
 * Serialize scan for JSON response (handle BigInt)
 */
export function serializeScan(scan: any): any {
  return JSON.parse(JSON.stringify(scan, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

// Helper functions
function extractBaseImage(imageName?: string): string | undefined {
  if (!imageName) return undefined;
  
  // Extract base image from common patterns
  if (imageName.includes('node')) return 'node';
  if (imageName.includes('python')) return 'python';
  if (imageName.includes('nginx')) return 'nginx';
  if (imageName.includes('alpine')) return 'alpine';
  if (imageName.includes('ubuntu')) return 'ubuntu';
  if (imageName.includes('debian')) return 'debian';
  
  return imageName.split(':')[0];
}

function mapScanStatus(status: string): "Complete" | "Queued" | "Error" | "Prior" {
  switch (status) {
    case 'SUCCESS': return 'Complete';
    case 'RUNNING': return 'Queued';
    case 'FAILED': return 'Error';
    case 'PARTIAL': return 'Complete';
    case 'CANCELLED': return 'Error';
    default: return 'Prior';
  }
}

function extractOsInfo(scan: ScanWithImage): { family: string; name: string } | undefined {
  const trivyReport = scan.scannerReports?.trivy;
  if (trivyReport?.Metadata?.OS) {
    return {
      family: trivyReport.Metadata.OS.Family,
      name: trivyReport.Metadata.OS.Name,
    };
  }
  return undefined;
}

/**
 * Type guard to check if data is a Prisma Scan
 */
export function isPrismaScan(data: any): data is PrismaScan {
  return data && typeof data.id === 'string' && data.requestId && data.createdAt;
}

/**
 * Type guard to check if data is a Legacy Scan
 */
export function isLegacyScan(data: any): data is LegacyScan {
  return data && typeof data.id === 'number' && data.uid && data.lastScan;
}