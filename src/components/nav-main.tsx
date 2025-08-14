"use client"

import { IconCirclePlusFilled, IconMail, type Icon } from "@tabler/icons-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { NewScanModal } from "@/components/new-scan-modal"
import { Separator } from "./ui/separator"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: Icon
  }[]
}) {
  const pathname = usePathname()
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">

        <Separator className="mb-2" />
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <NewScanModal>
              <SidebarMenuButton
                tooltip="New Scan"
                className="bg-blue-500 text-primary-foreground hover:bg-blue-500/70 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear cursor-pointer"
              >
                <IconCirclePlusFilled />
                <span>New Scan</span>
              </SidebarMenuButton>
            </NewScanModal>
          </SidebarMenuItem>
        </SidebarMenu>
        <Separator className="mt-2" />
        <SidebarMenu>
          {items.map((item) => {
            const isActive = pathname === item.url
            return (
              <Link href={item.url} key={item.title} className="!cursor-pointer">
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    tooltip={item.title}
                    className={`hover:bg-blue-300 cursor-pointer ${isActive ? "bg-blue-100" : ""}`}
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Link>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
