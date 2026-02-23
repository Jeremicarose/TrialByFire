/// <reference types="vite/client" />

/*
 * Extend the Window interface to include MetaMask's ethereum provider.
 * MetaMask injects window.ethereum (an EIP-1193 provider) into every
 * page. TypeScript doesn't know about it by default, so we declare it.
 */
interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  };
}
