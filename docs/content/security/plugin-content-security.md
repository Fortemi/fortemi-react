# Plugin Content Security

Fortemi does not execute remote plugin UI by default. Hosts that opt into plugin-loaded scripts must enforce three controls before a script is loaded:

1. A restrictive Content Security Policy.
2. Operator allowlisting for every plugin script origin or exact URL.
3. Subresource Integrity for every external script.

## Default CSP

Use buildPluginCsp() from @fortemi/core when emitting headers or HTML meta tags for a host application.

Example:

    import { buildPluginCsp } from "@fortemi/core"
    const policy = buildPluginCsp({
      scriptSrc: ["https://plugins.example.org"],
      connectSrc: ["https://plugins.example.org"],
      reportUri: "/api/csp-report",
    })
    response.headers.set("Content-Security-Policy-Report-Only", policy)

The generated baseline includes default-src self, object-src none, and script-src self strict-dynamic. Run new deployments in report-only mode first. After the report stream is clean, move the same policy to Content-Security-Policy.

## Script Allowlist

Operators must approve each plugin origin or exact script URL. A wildcard origin is accepted by the API for controlled private deployments, but public or multi-tenant hosts should not use it.

    import { fetchPluginScript } from "@fortemi/core"
    const plugin = await fetchPluginScript(
      {
        url: "https://plugins.example.org/plugin-a/index.js",
        integrity: "sha384-base64digest",
      },
      {
        allowedOrigins: ["https://plugins.example.org"],
        allowedUrls: ["https://plugins.example.org/plugin-a/index.js"],
      },
    )

fetchPluginScript() fails before network access when the URL is not allowlisted or when an integrity value is missing. It fetches the script bytes, verifies SRI, and returns the script text for a host-controlled loader.

Browser hosts that intentionally append a module script can use appendPluginScript(). It applies the same allowlist and SRI requirements before adding the script tag.

## Subresource Integrity

Integrity values use standard SRI syntax, for example sha384-BASE64_DIGEST.

Use computeSri(bytes) when publishing a plugin artifact and verifySri(bytes, integrity) before loading. Fortemi supports sha256, sha384, and sha512; sha384 is the default.

An SRI mismatch is a load failure. Hosts must surface that failure as a plugin installation or activation error, not retry from a different URL.

## CSP Reports

Mount createCspReportHandler() at the report URI used in the CSP. The handler accepts browser report-uri payloads and normalized Reporting API payloads, then calls your telemetry sink.

    import { createCspReportHandler } from "@fortemi/core"
    const handleCspReport = createCspReportHandler(async report => {
      await telemetry.write({
        type: "csp_violation",
        blockedUri: report.blockedUri,
        effectiveDirective: report.effectiveDirective,
        originalPolicy: report.originalPolicy,
      })
    })

Do not include secrets in plugin URLs or CSP report paths. Browsers may include blocked URLs in violation payloads.

## Operator Checklist

- Start with Content-Security-Policy-Report-Only and a configured report URI.
- Add plugin origins only after operator approval.
- Require SRI for every external plugin script.
- Treat SRI mismatch, missing SRI, and non-allowlisted origin as hard failures.
- Review CSP reports before enforcing the policy.
- Document every approved plugin origin in deployment configuration.
