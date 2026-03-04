import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";

/**
 * useWallet — Manages MetaMask wallet connection for the frontend.
 *
 * This hook handles the entire wallet lifecycle:
 *   1. Detecting if MetaMask is installed
 *   2. Connecting to the user's wallet
 *   3. Reading the connected account address
 *   4. Checking if the connected account is the contract owner
 *   5. Listening for account/chain changes
 *
 * Why ethers.BrowserProvider?
 *   MetaMask injects window.ethereum (an EIP-1193 provider) into the page.
 *   ethers.BrowserProvider wraps this raw provider into a full ethers.js
 *   provider with signer support, so we can send transactions.
 *
 * Returns:
 *   account    — Connected wallet address (null if disconnected)
 *   isOwner    — True if the connected account owns the TrialMarket contract
 *   isConnected — True if a wallet is connected
 *   connect    — Function to trigger MetaMask connection popup
 *   provider   — ethers BrowserProvider (for passing to useContract)
 *   signer     — ethers Signer (for sending transactions)
 *   error      — Error message if connection fails
 */

/*
 * The TrialMarket contract address. In a production app, this would
 * come from environment variables or a deployment manifest.
 * For the hackathon, we'll set it from Vite's env system.
 *
 * Vite exposes env vars prefixed with VITE_ to the client bundle.
 */
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";

/*
 * Minimal ABI — just the owner() function for checking admin status.
 * We don't need the full ABI here; useContract handles the rest.
 */
const OWNER_ABI = ["function owner() view returns (address)"];

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Check if the connected account is the contract owner.
   * This determines whether the "Create Market" button appears.
   *
   * We call the contract's owner() function (from Ownable) and
   * compare the result to the connected account. Case-insensitive
   * comparison because Ethereum addresses can be mixed-case (EIP-55).
   */
  const checkOwnership = useCallback(
    async (address: string, prov: ethers.BrowserProvider) => {
      if (!CONTRACT_ADDRESS) {
        setIsOwner(false);
        return;
      }
      try {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, OWNER_ABI, prov);
        const ownerAddress = await contract.owner();
        setIsOwner(ownerAddress.toLowerCase() === address.toLowerCase());
      } catch {
        /*
         * If the contract call fails (e.g., wrong network, contract
         * not deployed), default to not-owner. The user can still
         * interact with other parts of the app.
         */
        setIsOwner(false);
      }
    },
    []
  );

  /**
   * Connect to MetaMask.
   *
   * Calls eth_requestAccounts which triggers MetaMask's connection
   * popup if the user hasn't already approved this site.
   * If they have, it returns the connected account silently.
   */
  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setError("MetaMask not installed. Please install MetaMask to use this app.");
      return;
    }

    try {
      setError(null);
      const browserProvider = new ethers.BrowserProvider(window.ethereum);

      /*
       * eth_requestAccounts prompts the user to connect their wallet.
       * It returns an array of account addresses — we use the first one.
       */
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      const address = accounts[0];

      const walletSigner = await browserProvider.getSigner();

      setAccount(address);
      setProvider(browserProvider);
      setSigner(walletSigner);

      await checkOwnership(address, browserProvider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
    }
  }, [checkOwnership]);

  /*
   * Auto-connect on page load.
   * If the user previously connected, MetaMask remembers the approval.
   * eth_accounts (not eth_requestAccounts) checks silently — no popup.
   * This prevents the user from having to click "Connect" every refresh.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const autoConnect = async () => {
      try {
        const browserProvider = new ethers.BrowserProvider(window.ethereum!);
        const accounts = await browserProvider.send("eth_accounts", []);
        if (accounts.length > 0) {
          const walletSigner = await browserProvider.getSigner();
          setAccount(accounts[0]);
          setProvider(browserProvider);
          setSigner(walletSigner);
          await checkOwnership(accounts[0], browserProvider);
        }
      } catch {
        /* Silently fail — user can click Connect manually */
      }
    };
    autoConnect();
  }, [checkOwnership]);

  /*
   * Listen for MetaMask events.
   *
   * accountsChanged: Fires when the user switches accounts in MetaMask.
   *   We update our state to reflect the new account.
   *
   * chainChanged: Fires when the user switches networks (e.g., Sepolia → Mainnet).
   *   We reload the page because the contract address may be different on
   *   the new network. A full reload is the simplest way to reset all state.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        // User disconnected their wallet
        setAccount(null);
        setIsOwner(false);
        setSigner(null);
        setProvider(null);
      } else {
        /*
         * Create a FRESH provider and signer on account switch.
         * The old BrowserProvider caches the previous account internally,
         * so reusing it causes stale reads (user sees old wallet's data).
         * A new BrowserProvider picks up the newly selected account.
         */
        const freshProvider = new ethers.BrowserProvider(window.ethereum!);
        const freshSigner = await freshProvider.getSigner();
        setAccount(accounts[0]);
        setProvider(freshProvider);
        setSigner(freshSigner);
        await checkOwnership(accounts[0], freshProvider);
      }
    };

    const handleChainChanged = () => {
      // Full reload on chain change — simplest way to reset all contract state
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, [provider, checkOwnership]);

  return {
    account,
    isOwner,
    isConnected: !!account,
    connect,
    provider,
    signer,
    error,
  };
}
