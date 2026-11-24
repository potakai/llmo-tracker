import { BlockList, isIP } from 'node:net'

/**
 * サーバーから読みに行ってはいけない IP アドレス（SSRF の対策）。
 * プライベート・ループバック・リンクローカル（クラウドのメタデータ 169.254.169.254 を含む）・
 * 共有アドレス（100.64.0.0/10。Alibaba Cloud のメタデータ 100.100.100.200 を含む）・マルチキャスト・
 * ドキュメント用・予約済みなど、インターネットの公開アドレスではないものはすべて止める。
 *
 * 出どころ：IANA の Special-Purpose Address Registry
 * https://www.iana.org/assignments/iana-ipv4-special-registry/
 * https://www.iana.org/assignments/iana-ipv6-special-registry/
 */
const BLOCKED_IPV4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const BLOCKED_IPV6: [string, number][] = [
  // 未指定・ループバック・IPv4 互換（中に IPv4 を埋め込める）
  ['::', 96],
  // IPv4 射影（::ffff:127.0.0.1 など。中の IPv4 でループバックなどに届く）
  ['::ffff:0:0', 96],
  // NAT64（中の IPv4 に変換されて届く）
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  // IETF のプロトコル用（Teredo を含む）・ドキュメント用・6to4（中に IPv4 を埋め込める）
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  // ユニークローカル（AWS のメタデータ fd00:ec2::254 を含む）・リンクローカル・サイトローカル・マルチキャスト
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]

// IPv4 と IPv6 で分ける（1 つにまとめると、Node.js は IPv4 を ::ffff:a.b.c.d としても照合するので、
// IPv4 射影の範囲に IPv4 の全部が当たってしまう）
const blockedV4 = new BlockList()
for (const [address, prefix] of BLOCKED_IPV4) blockedV4.addSubnet(address, prefix, 'ipv4')
const blockedV6 = new BlockList()
for (const [address, prefix] of BLOCKED_IPV6) blockedV6.addSubnet(address, prefix, 'ipv6')

/** URL のホスト名の IPv6（[::1]）から角かっこを取る */
export function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** 読みに行ってよい（インターネットの公開アドレスの）IP か。IP として読めなければ false */
export function isPublicAddress(address: string): boolean {
  const ip = stripBrackets(address)
  const version = isIP(ip)
  if (version === 0) return false
  return version === 4 ? !blockedV4.check(ip, 'ipv4') : !blockedV6.check(ip, 'ipv6')
}
