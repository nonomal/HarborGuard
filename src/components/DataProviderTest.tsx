"use client"

import { useScans } from '@/hooks/useScans'
import { useRepositories } from '@/hooks/useRepositories'
import { useVulnerabilities } from '@/hooks/useVulnerabilities'
import { usePolicies } from '@/hooks/usePolicies'
import { useUsers } from '@/hooks/useUsers'

export function DataProviderTest() {
  const { scans, stats: scanStats, loading: scansLoading } = useScans()
  const { repositories, stats: repoStats } = useRepositories()
  const { vulnerabilities, stats: vulnStats } = useVulnerabilities()
  const { policies, stats: policyStats } = usePolicies()
  const { users, currentUser } = useUsers()

  if (scansLoading) {
    return <div>Loading data providers...</div>
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Data Provider Test</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold">Scans</h3>
          <p>Total: {scanStats.totalScans}</p>
          <p>Critical Vulns: {scanStats.vulnerabilities.critical}</p>
          <p>Avg Risk Score: {scanStats.avgRiskScore}</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold">Repositories</h3>
          <p>Total: {repoStats.totalRepos}</p>
          <p>Total Images: {repoStats.totalImages}</p>
          <p>High Risk: {repoStats.highRiskRepos}</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold">Vulnerabilities</h3>
          <p>Total: {vulnStats.total}</p>
          <p>Critical: {vulnStats.bySeverity.critical}</p>
          <p>Fixable: {vulnStats.fixable.percent}%</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold">Policies</h3>
          <p>Total: {policyStats.total}</p>
          <p>Enabled: {policyStats.enabled}</p>
          <p>Assigned Repos: {policyStats.assignedRepositoriesCount}</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold">Users</h3>
          <p>Total: {users.length}</p>
          <p>Current: {currentUser?.fullName}</p>
          <p>Role: {currentUser?.role}</p>
        </div>

        <div className="p-4 border rounded-lg">
          <h3 className="font-semibold">Data Status</h3>
          <p>Scans: {scans.length} loaded</p>
          <p>Repos: {repositories.length} loaded</p>
          <p>Vulns: {vulnerabilities.length} loaded</p>
          <p>Policies: {policies.length} loaded</p>
        </div>
      </div>
    </div>
  )
}