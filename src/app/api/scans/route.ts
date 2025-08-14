import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { prismaToScanWithImage, serializeScan } from '@/lib/type-utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const imageId = searchParams.get('imageId')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    
    const where: any = {}
    
    if (status) {
      where.status = status.toUpperCase()
    }
    
    if (imageId) {
      where.imageId = imageId
    }
    
    const [scans, total] = await Promise.all([
      prisma.scan.findMany({
        where,
        include: {
          image: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: limit,
        skip: offset
      }),
      prisma.scan.count({ where })
    ])
    
    // Convert Prisma data to properly typed scans
    const scansData = scans.map(scan => prismaToScanWithImage(scan));
    
    return NextResponse.json({
      scans: serializeScan(scansData),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    })
  } catch (error) {
    console.error('Error retrieving scans:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}