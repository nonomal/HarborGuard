import { useApp } from '@/contexts/AppContext'
import { useMemo } from 'react'

export function useVulnerabilities() {
  const { state } = useApp()
  
  const vulnerabilities = state.vulnerabilities
  const loading = state.loading
  const error = state.error

  const stats = useMemo(() => {
    const totalVulns = vulnerabilities.length
    const criticalVulns = vulnerabilities.filter(v => v.severity === 'critical').length
    const highVulns = vulnerabilities.filter(v => v.severity === 'high').length
    const mediumVulns = vulnerabilities.filter(v => v.severity === 'medium').length
    const lowVulns = vulnerabilities.filter(v => v.severity === 'low').length

    const fixableVulns = vulnerabilities.filter(v => v.fixable).length
    const fixablePercent = totalVulns > 0 ? Math.round((fixableVulns / totalVulns) * 100) : 0

    const avgCvssScore = vulnerabilities.length > 0 
      ? vulnerabilities.reduce((sum, v) => sum + v.cvssScore, 0) / vulnerabilities.length 
      : 0


    return {
      total: totalVulns,
      bySeverity: {
        critical: criticalVulns,
        high: highVulns,
        medium: mediumVulns,
        low: lowVulns
      },
      fixable: {
        count: fixableVulns,
        percent: fixablePercent
      },
      avgCvssScore: Math.round(avgCvssScore * 10) / 10
    }
  }, [vulnerabilities])

  const getVulnerabilityById = (id: string) => {
    return vulnerabilities.find(vuln => vuln.id === id)
  }

  const getVulnerabilitiesBySeverity = (severity: string) => {
    return vulnerabilities.filter(vuln => vuln.severity === severity)
  }

  const getVulnerabilitiesByPackage = (packageName: string) => {
    return vulnerabilities.filter(vuln => vuln.package === packageName)
  }

  const getFixableVulnerabilities = () => {
    return vulnerabilities.filter(vuln => vuln.fixable)
  }


  const getVulnerabilitiesForImage = (imageId: number) => {
    return vulnerabilities.filter(vuln => vuln.affectedImages.includes(imageId))
  }

  const searchVulnerabilities = (query: string) => {
    const lowercaseQuery = query.toLowerCase()
    return vulnerabilities.filter(vuln => 
      vuln.id.toLowerCase().includes(lowercaseQuery) ||
      vuln.title.toLowerCase().includes(lowercaseQuery) ||
      vuln.description.toLowerCase().includes(lowercaseQuery) ||
      vuln.package.toLowerCase().includes(lowercaseQuery)
    )
  }

  const getTopPackagesWithVulnerabilities = (limit = 10) => {
    const packageCounts = vulnerabilities.reduce((acc, vuln) => {
      acc[vuln.package] = (acc[vuln.package] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return Object.entries(packageCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([package_, count]) => ({ package: package_, count }))
  }

  return {
    vulnerabilities,
    loading,
    error,
    stats,
    getVulnerabilityById,
    getVulnerabilitiesBySeverity,
    getVulnerabilitiesByPackage,
    getFixableVulnerabilities,
    getVulnerabilitiesForImage,
    searchVulnerabilities,
    getTopPackagesWithVulnerabilities
  }
}