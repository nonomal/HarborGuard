import { NextRequest, NextResponse } from 'next/server'
import { scannerService } from '@/lib/scanner'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const jobs = scannerService.getAllJobs()
    
    // Get image details for each job
    const jobsWithImageInfo = await Promise.all(
      jobs.map(async (job) => {
        try {
          const image = await prisma.image.findUnique({
            where: { id: job.imageId }
          })
          
          return {
            requestId: job.requestId,
            scanId: job.scanId,
            imageId: job.imageId,
            imageName: image ? `${image.name}:${image.tag}` : job.imageId,
            status: job.status,
            progress: job.progress,
            error: job.error
          }
        } catch (error) {
          console.error(`Error fetching image details for job ${job.requestId}:`, error)
          return {
            requestId: job.requestId,
            scanId: job.scanId,
            imageId: job.imageId,
            imageName: job.imageId, // fallback to imageId if lookup fails
            status: job.status,
            progress: job.progress,
            error: job.error
          }
        }
      })
    )
    
    return NextResponse.json({
      jobs: jobsWithImageInfo
    })
    
  } catch (error) {
    console.error('Error getting scan jobs:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}