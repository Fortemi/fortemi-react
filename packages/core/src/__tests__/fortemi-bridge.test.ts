import { describe, expect, it } from 'vitest'
import {
  getFortemiBridge,
  getFortemiSecretStore,
  hasFortemiSecureSecrets,
  type FortemiBridgeHost,
} from '../fortemi-bridge.js'

describe('Fortemi bridge host detection', () => {
  it('detects secure secrets from the bridge contract', async () => {
    const host: FortemiBridgeHost = {
      fortemiBridge: {
        version: '1.0.0',
        capabilities: async () => ({
          secureSecrets: true,
          providerRouting: true,
          localNetworkAccess: true,
          auditLog: true,
        }),
        secrets: {
          isAvailable: async () => true,
          getSecret: async () => null,
          setSecret: async () => {},
          deleteSecret: async () => {},
        },
      },
    }

    expect(getFortemiBridge(host)?.version).toBe('1.0.0')
    expect(getFortemiSecretStore(host)).toBe(host.fortemiBridge?.secrets)
    await expect(hasFortemiSecureSecrets(host)).resolves.toBe(true)
  })

  it('fails closed when secure secret capability is absent', async () => {
    const host: FortemiBridgeHost = {
      fortemiBridge: {
        version: '1.0.0',
        capabilities: async () => ({
          secureSecrets: false,
          providerRouting: true,
          localNetworkAccess: true,
          auditLog: true,
        }),
        secrets: {
          isAvailable: async () => true,
          getSecret: async () => 'secret',
          setSecret: async () => {},
          deleteSecret: async () => {},
        },
      },
    }

    await expect(hasFortemiSecureSecrets(host)).resolves.toBe(false)
  })

  it('supports the legacy secure storage host while standalone migrates', async () => {
    const host: FortemiBridgeHost = {
      fortemiSecureStorage: {
        isAvailable: () => true,
        getSecret: async () => null,
        setSecret: async () => {},
        deleteSecret: async () => {},
      },
    }

    expect(getFortemiSecretStore(host)).toBe(host.fortemiSecureStorage)
    await expect(hasFortemiSecureSecrets(host)).resolves.toBe(true)
  })
})
