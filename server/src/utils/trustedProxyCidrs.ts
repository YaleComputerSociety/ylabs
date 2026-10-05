import { BlockList, isIP } from 'node:net';

export const WIDEST_TRUSTED_IPV4_PREFIX = 8;
export const WIDEST_TRUSTED_IPV6_PREFIX = 29;

const IPV4_MAPPED_IPV6_PREFIX_BITS = 96;
const WIDEST_TRUSTED_IPV4_MAPPED_PREFIX = IPV4_MAPPED_IPV6_PREFIX_BITS + WIDEST_TRUSTED_IPV4_PREFIX;
const IPV4_MAPPED_IPV6_NETWORK = '::ffff:0:0';

const ipv4MappedIpv6Space = new BlockList();
ipv4MappedIpv6Space.addSubnet(IPV4_MAPPED_IPV6_NETWORK, IPV4_MAPPED_IPV6_PREFIX_BITS, 'ipv6');

export interface TrustedProxyAddresses {
  count: number;
  isTrusted: (peerAddress: string) => boolean;
}

const invalidEntry = (value: string): Error =>
  new Error(`TRUSTED_PROXY_CIDRS contains an invalid address or CIDR: ${value}`);

const overBroadEntry = (value: string, widestPrefix: number): Error =>
  new Error(
    `TRUSTED_PROXY_CIDRS contains an over-broad range ${value}; a trusted proxy range may be no wider than /${widestPrefix}, because a wider one lets any client choose its own forwarded address.`,
  );

const ipv6RangeIsOverBroadOverIpv4 = (address: string, prefix: number): boolean => {
  if (prefix > IPV4_MAPPED_IPV6_PREFIX_BITS) {
    return ipv4MappedIpv6Space.check(address, 'ipv6') && prefix < WIDEST_TRUSTED_IPV4_MAPPED_PREFIX;
  }
  const range = new BlockList();
  range.addSubnet(address, prefix, 'ipv6');
  return range.check(IPV4_MAPPED_IPV6_NETWORK, 'ipv6');
};

const assertNotOverBroad = (
  value: string,
  address: string,
  addressType: number,
  prefix: number,
) => {
  if (addressType === 4) {
    if (prefix < WIDEST_TRUSTED_IPV4_PREFIX)
      throw overBroadEntry(value, WIDEST_TRUSTED_IPV4_PREFIX);
    return;
  }
  if (prefix < WIDEST_TRUSTED_IPV6_PREFIX) throw overBroadEntry(value, WIDEST_TRUSTED_IPV6_PREFIX);
  if (ipv6RangeIsOverBroadOverIpv4(address, prefix)) {
    throw overBroadEntry(value, WIDEST_TRUSTED_IPV4_MAPPED_PREFIX);
  }
};

const normalizedPeerAddress = (value: string): string =>
  value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;

export function parseTrustedProxyCidrs(raw: string | undefined): TrustedProxyAddresses {
  const blockList = new BlockList();
  let count = 0;
  for (const entry of (raw || '').split(',')) {
    const value = entry.trim();
    if (!value) continue;
    const cidrParts = value.split('/');
    const [address, prefixValue] = cidrParts;
    const addressType = isIP(address);
    const hasValidPrefixSyntax = prefixValue === undefined || /^\d+$/.test(prefixValue);
    const prefix = prefixValue === undefined ? undefined : Number(prefixValue);
    const maximumPrefix = addressType === 4 ? 32 : 128;
    if (
      cidrParts.length > 2 ||
      addressType === 0 ||
      !hasValidPrefixSyntax ||
      (prefix !== undefined && (!Number.isInteger(prefix) || prefix < 0 || prefix > maximumPrefix))
    ) {
      throw invalidEntry(value);
    }
    const family = addressType === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      blockList.addAddress(address, family);
    } else {
      assertNotOverBroad(value, address, addressType, prefix);
      blockList.addSubnet(address, prefix, family);
    }
    count += 1;
  }

  return {
    count,
    isTrusted: (peerAddress: string): boolean => {
      const address = normalizedPeerAddress(peerAddress);
      const addressType = isIP(address);
      return addressType !== 0 && blockList.check(address, addressType === 4 ? 'ipv4' : 'ipv6');
    },
  };
}
