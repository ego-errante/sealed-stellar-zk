"use client";

import { Copy, LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@/hooks/useWallet";
import { truncate } from "@/lib/utils";

export function WalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (!address) {
    return (
      <Button onClick={connect} disabled={connecting} size="sm">
        <Wallet className="mr-2 h-4 w-4" />
        {connecting ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="font-mono">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-verify" />
          {truncate(address)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard.writeText(address);
            toast.success("Address copied");
          }}
        >
          <Copy className="mr-2 h-4 w-4" /> Copy address
        </DropdownMenuItem>
        <DropdownMenuItem onClick={disconnect}>
          <LogOut className="mr-2 h-4 w-4" /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
