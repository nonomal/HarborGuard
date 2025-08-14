import { useApp } from '@/contexts/AppContext'
import { useMemo } from 'react'

export function usePolicies() {
  const { state } = useApp()
  
  const policies = state.policies
  const loading = state.loading
  const error = state.error

  const stats = useMemo(() => {
    const totalPolicies = policies.length
    const enabledPolicies = policies.filter(p => p.enabled).length
    const disabledPolicies = totalPolicies - enabledPolicies

    const ruleTypes = policies.reduce((acc, policy) => {
      policy.rules.forEach(rule => {
        acc[rule.type] = (acc[rule.type] || 0) + 1
      })
      return acc
    }, {} as Record<string, number>)

    const actionTypes = policies.reduce((acc, policy) => {
      policy.rules.forEach(rule => {
        acc[rule.action] = (acc[rule.action] || 0) + 1
      })
      return acc
    }, {} as Record<string, number>)

    const assignedRepos = new Set()
    policies.forEach(policy => {
      policy.assignedRepositories.forEach(repoId => assignedRepos.add(repoId))
    })

    return {
      total: totalPolicies,
      enabled: enabledPolicies,
      disabled: disabledPolicies,
      ruleTypes,
      actionTypes,
      assignedRepositoriesCount: assignedRepos.size
    }
  }, [policies])

  const getPolicyById = (id: number) => {
    return policies.find(policy => policy.id === id)
  }

  const getEnabledPolicies = () => {
    return policies.filter(policy => policy.enabled)
  }

  const getDisabledPolicies = () => {
    return policies.filter(policy => !policy.enabled)
  }

  const getPoliciesForRepository = (repositoryId: number) => {
    return policies.filter(policy => 
      policy.assignedRepositories.includes(repositoryId)
    )
  }

  const searchPolicies = (query: string) => {
    const lowercaseQuery = query.toLowerCase()
    return policies.filter(policy => 
      policy.name.toLowerCase().includes(lowercaseQuery) ||
      policy.description.toLowerCase().includes(lowercaseQuery)
    )
  }

  const getPolicyRulesBySeverity = (policyId: number, severity: string) => {
    const policy = getPolicyById(policyId)
    if (!policy) return []
    
    return policy.rules.filter(rule => rule.severity === severity)
  }

  const getPolicyRulesByType = (policyId: number, type: string) => {
    const policy = getPolicyById(policyId)
    if (!policy) return []
    
    return policy.rules.filter(rule => rule.type === type)
  }

  const checkPolicyViolation = (policyId: number, scanData: any) => {
    const policy = getPolicyById(policyId)
    if (!policy || !policy.enabled) return { violated: false, violations: [] }

    const violations = []

    for (const rule of policy.rules) {
      switch (rule.type) {
        case 'vulnerability':
          if (rule.severity && scanData.severities) {
            const count = scanData.severities[rule.severity === 'critical' ? 'crit' : rule.severity]
            if (count > rule.threshold) {
              violations.push({
                rule,
                actual: count,
                threshold: rule.threshold,
                message: `${rule.severity} vulnerabilities (${count}) exceed threshold (${rule.threshold})`
              })
            }
          }
          break
        case 'misconfiguration':
          if (scanData.misconfigs && scanData.misconfigs > rule.threshold) {
            violations.push({
              rule,
              actual: scanData.misconfigs,
              threshold: rule.threshold,
              message: `Misconfigurations (${scanData.misconfigs}) exceed threshold (${rule.threshold})`
            })
          }
          break
        case 'secrets':
          if (scanData.secrets && scanData.secrets > rule.threshold) {
            violations.push({
              rule,
              actual: scanData.secrets,
              threshold: rule.threshold,
              message: `Secrets (${scanData.secrets}) exceed threshold (${rule.threshold})`
            })
          }
          break
      }
    }

    return {
      violated: violations.length > 0,
      violations
    }
  }

  return {
    policies,
    loading,
    error,
    stats,
    getPolicyById,
    getEnabledPolicies,
    getDisabledPolicies,
    getPoliciesForRepository,
    searchPolicies,
    getPolicyRulesBySeverity,
    getPolicyRulesByType,
    checkPolicyViolation
  }
}