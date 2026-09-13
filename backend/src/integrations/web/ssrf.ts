/** SSRF protection: only public http(s) destinations may be fetched. */
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { IntegrationError } from "../types.js";

export type LookupFn = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;

const blockList = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blockList.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::1", 128], // loopback
  ["::", 128], // unspecified
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["64:ff9b::", 96], // NAT64
  ["2001:db8::", 32], // documentation
] as const) {
  blockList.addSubnet(net, prefix, "ipv6");
}

/** Canonicalizes an IPv6 literal via the WHATWG URL parser (e.g. `::ffff:127.0.0.1` → `::ffff:7f00:1`). */
function canonicalIpv6(address: string): string {
  try {
    return new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return address.toLowerCase();
  }
}

export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(ip);
  if (family === 4) return blockList.check(ip, "ipv4");
  if (family === 6) {
    const canonical = canonicalIpv6(ip);
    // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d) addresses are never fetched.
    if (canonical.startsWith("::ffff:") || /^::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?$/.test(canonical)) return true;
    return blockList.check(canonical, "ipv6");
  }
  return true; // not an IP at all → refuse
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet", ".corp"];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host === "localhost.localdomain" || !host.includes(".")) return true;
  if (host === "metadata.google.internal" || host === "metadata") return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const blocked = () =>
  new IntegrationError("web", "INVALID_INPUT", "This URL points to a private, local or reserved network address and cannot be fetched.");

/** Validates scheme + hostname and every resolved address. Returns the parsed URL. */
export async function assertPublicUrl(rawUrl: string | URL, lookup: LookupFn = dnsLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new IntegrationError("web", "INVALID_INPUT", "Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IntegrationError("web", "INVALID_INPUT", "Only http(s) URLs can be fetched.");
  }
  if (url.username || url.password) throw new IntegrationError("web", "INVALID_INPUT", "URLs with embedded credentials are not allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw blocked();
    return url;
  }
  if (isBlockedHostname(host)) throw blocked();

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new IntegrationError("web", "NOT_FOUND", `Could not resolve host "${host}".`);
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) throw blocked();
  return url;
}
