import { describe, expect, it } from 'vitest'
import { isPublicAddress } from '../src/ip'

describe('読みに行ってよい IP の判定', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.100.100.200',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '::',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '2002:7f00:1::',
    'fc00::1',
    'fd00:ec2::254',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
  ])('%s は公開のアドレスではないので読まない', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])(
    '%s は公開のアドレスなので読んでよい',
    (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )

  it('IP として読めないものは読まない', () => {
    expect(isPublicAddress('localhost')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
    expect(isPublicAddress('fe80::1%eth0')).toBe(false)
  })
})
