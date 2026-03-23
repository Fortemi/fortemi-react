export interface SWRegistrationResult {
  registered: boolean
  registration?: ServiceWorkerRegistration
  error?: string
}

export async function registerServiceWorker(
  swUrl: string = '/sw.js',
): Promise<SWRegistrationResult> {
  if (!('serviceWorker' in navigator)) {
    return { registered: false, error: 'Service Workers not supported' }
  }

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      type: 'module',
      scope: '/',
    })

    // Wait for the SW to become active
    if (registration.installing) {
      await new Promise<void>((resolve) => {
        registration.installing!.addEventListener('statechange', function handler() {
          if (this.state === 'activated') {
            this.removeEventListener('statechange', handler)
            resolve()
          }
        })
      })
    }

    return { registered: true, registration }
  } catch (err) {
    return {
      registered: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
