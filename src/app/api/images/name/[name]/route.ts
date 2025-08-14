import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    
    // Decode the image name in case it has special characters
    const decodedName = decodeURIComponent(name)
    
    // Fetch all images with this name (across all tags and registries)
    const images = await prisma.image.findMany({
      where: { 
        name: decodedName 
      },
      include: {
        scans: {
          orderBy: { startedAt: 'desc' },
          include: {
            image: true
          }
        }
      },
      orderBy: [
        { tag: 'desc' }, // Show latest tags first
        { createdAt: 'desc' }
      ]
    })
    
    if (images.length === 0) {
      return NextResponse.json(
        { error: 'No images found with this name' },
        { status: 404 }
      )
    }
    
    // Flatten all scans from all tags into one list
    const allScans = images.flatMap(image => 
      image.scans.map(scan => ({
        ...scan,
        sizeBytes: scan.sizeBytes?.toString() || null,
        image: {
          ...scan.image,
          sizeBytes: scan.image.sizeBytes?.toString() || null
        }
      }))
    )
    
    // Sort all scans by date (most recent first)
    allScans.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    
    // Get the most recent image info for the main display
    const latestImage = images[0]
    
    // Convert BigInt to string for JSON serialization
    const serializedResponse = {
      name: decodedName,
      images: images.map(image => ({
        ...image,
        sizeBytes: image.sizeBytes?.toString() || null,
        scans: [] // Remove scans from images to avoid duplication
      })),
      allScans,
      latestImage: {
        ...latestImage,
        sizeBytes: latestImage.sizeBytes?.toString() || null,
        scans: [] // Remove scans to avoid BigInt issues
      },
      // Summary stats across all tags
      totalScans: allScans.length,
      tags: [...new Set(images.map(img => img.tag))].sort(),
      registries: [...new Set(images.map(img => img.registry).filter(Boolean))]
    }
    
    return NextResponse.json(serializedResponse)
    
  } catch (error) {
    console.error('Error fetching image by name:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}