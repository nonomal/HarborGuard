import { useApp } from '@/contexts/AppContext'
import { useMemo } from 'react'

export function useUsers() {
  const { state, dispatch } = useApp()
  
  const users = state.users
  const currentUser = state.currentUser
  const loading = state.loading
  const error = state.error

  const stats = useMemo(() => {
    const totalUsers = users.length
    const roleStats = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const departmentStats = users.reduce((acc, user) => {
      acc[user.department] = (acc[user.department] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const themeStats = users.reduce((acc, user) => {
      acc[user.preferences.theme] = (acc[user.preferences.theme] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const recentlyActive = users.filter(user => {
      const lastLogin = new Date(user.lastLogin)
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      return lastLogin > dayAgo
    }).length

    return {
      total: totalUsers,
      byRole: roleStats,
      byDepartment: departmentStats,
      byTheme: themeStats,
      recentlyActive
    }
  }, [users])

  const getUserById = (id: number) => {
    return users.find(user => user.id === id)
  }

  const getUsersByRole = (role: string) => {
    return users.filter(user => user.role === role)
  }

  const getUsersByDepartment = (department: string) => {
    return users.filter(user => user.department === department)
  }

  const searchUsers = (query: string) => {
    const lowercaseQuery = query.toLowerCase()
    return users.filter(user => 
      user.username.toLowerCase().includes(lowercaseQuery) ||
      user.fullName.toLowerCase().includes(lowercaseQuery) ||
      user.email.toLowerCase().includes(lowercaseQuery) ||
      user.department.toLowerCase().includes(lowercaseQuery)
    )
  }

  const hasPermission = (permission: string, userId?: number) => {
    const user = userId ? getUserById(userId) : currentUser
    return user?.permissions.includes(permission) || false
  }

  const canAccessRepository = (repositoryId: number, userId?: number) => {
    const user = userId ? getUserById(userId) : currentUser
    if (!user) return false

    if (user.permissions.includes('view_all_repositories')) {
      return true
    }

    if (user.permissions.includes('view_team_repositories')) {
      return true
    }

    return false
  }

  const setCurrentUser = (user: typeof users[0] | null) => {
    dispatch({ type: 'SET_CURRENT_USER', payload: user })
  }

  const getNotificationPreferences = (userId?: number) => {
    const user = userId ? getUserById(userId) : currentUser
    return user?.preferences.notifications
  }

  const getDashboardPreferences = (userId?: number) => {
    const user = userId ? getUserById(userId) : currentUser
    return user?.preferences.dashboard
  }

  const getThemePreference = (userId?: number) => {
    const user = userId ? getUserById(userId) : currentUser
    return user?.preferences.theme || 'light'
  }

  const getRecentlyActiveUsers = (hours = 24) => {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
    return users.filter(user => {
      const lastLogin = new Date(user.lastLogin)
      return lastLogin > cutoff
    })
  }

  return {
    users,
    currentUser,
    loading,
    error,
    stats,
    getUserById,
    getUsersByRole,
    getUsersByDepartment,
    searchUsers,
    hasPermission,
    canAccessRepository,
    setCurrentUser,
    getNotificationPreferences,
    getDashboardPreferences,
    getThemePreference,
    getRecentlyActiveUsers
  }
}