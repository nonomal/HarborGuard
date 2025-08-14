import { useApp } from '@/contexts/AppContext'
import { useMemo } from 'react'

export function useRepositories() {
  const { state } = useApp()
  
  const repositories = state.repositories
  const loading = state.loading
  const error = state.error

  const stats = useMemo(() => {
    const totalRepos = repositories.length
    const totalImages = repositories.reduce((sum, repo) => sum + repo.totalImages, 0)
    const totalVulns = repositories.reduce((sum, repo) => sum + repo.totalVulnerabilities, 0)
    const avgRiskScore = repositories.length > 0 
      ? repositories.reduce((sum, repo) => sum + repo.riskScore, 0) / repositories.length 
      : 0

    const highRiskRepos = repositories.filter(repo => repo.riskScore > 70).length
    const privateRepos = repositories.filter(repo => repo.private).length
    const publicRepos = totalRepos - privateRepos

    const scanScheduleStats = repositories.reduce((acc, repo) => {
      acc[repo.scanSchedule] = (acc[repo.scanSchedule] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      totalRepos,
      totalImages,
      totalVulns,
      avgRiskScore: Math.round(avgRiskScore),
      highRiskRepos,
      privateRepos,
      publicRepos,
      scanScheduleStats
    }
  }, [repositories])

  const getRepositoryById = (id: number) => {
    return repositories.find(repo => repo.id === id)
  }

  const getRepositoriesByOwner = (owner: string) => {
    return repositories.filter(repo => repo.owner === owner)
  }

  const getRepositoriesByRiskLevel = (level: 'low' | 'medium' | 'high' | 'critical') => {
    const thresholds = {
      low: [0, 25],
      medium: [25, 50], 
      high: [50, 75],
      critical: [75, 100]
    }
    
    const [min, max] = thresholds[level]
    return repositories.filter(repo => repo.riskScore >= min && repo.riskScore < max)
  }

  const searchRepositories = (query: string) => {
    const lowercaseQuery = query.toLowerCase()
    return repositories.filter(repo => 
      repo.name.toLowerCase().includes(lowercaseQuery) ||
      repo.description.toLowerCase().includes(lowercaseQuery) ||
      repo.owner.toLowerCase().includes(lowercaseQuery)
    )
  }

  return {
    repositories,
    loading,
    error,
    stats,
    getRepositoryById,
    getRepositoriesByOwner,
    getRepositoriesByRiskLevel,
    searchRepositories
  }
}