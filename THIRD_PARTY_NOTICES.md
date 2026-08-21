# Third-party notices

Agent Network Studio (Apache License 2.0) bundles or references material from
MuleSoft / Salesforce projects. This file records provenance for redistribution
review. It is not legal advice.

## Agent Fabric JSON Schemas

**Location:** `lib/composer/schema/anf/*.json` (see `manifest.json` for checksums)

**Upstream:**

- Repository: [mulesoft-emu/agent-fabric-specification](https://github.com/mulesoft-emu/agent-fabric-specification)
- Subpath: `agent-fabric-schema/src/main/resources`
- Pinned commit (at last sync): `3cee4291f9b9ed92211412105ab188dfbbc938ab` (2026-07-15)

These files are official Agent Network / Agent Fabric JSON Schema definitions
used by Builder for validation. They are copied verbatim from the upstream repo
and refreshed with `npm run sync:anf-schemas`.

**License:** Confirm redistribution terms with Salesforce / MuleSoft or the
upstream repository before relying on this bundle in a commercial product. At
the time of bundling, no separate `LICENSE` file was found on the upstream
default branch; treat the schemas as MuleSoft specification material unless
MuleSoft publishes explicit open-source terms.

## IT Help Investigation example

**Location:** `lib/composer/examples/it-investigation-broker/`

**Upstream:**

- [MuleSoft-AI-Chain-Project/example-mule-apps — it-investigation-broker-example](https://github.com/MuleSoft-AI-Chain-Project/example-mule-apps/tree/master/agent-network-2.0-examples/it-investigation-broker-example)

Refreshed with `npm run sync:composer-examples`. Placeholder org IDs are used
in `exchange.json` (`{ENTER YOUR ORG ID HERE}`).

## Vogue Premiere broker template

**Location:** `lib/composer/examples/vogue-premiere-broker/`

**Upstream:**

- [MuleSoft Agent Fabric Actionability Workshop](https://actionability.workshops.mulesoft.com/)

The `vogue-premiere-broker-v2-template` project handed out by the workshop,
bundled so users can open it in Builder without downloading it. Refreshed with
`npm run sync:composer-examples`. Placeholder org IDs are used in
`exchange.json` (`{ENTER YOUR ORG ID HERE}`); connection `ref.namespace` pins
and the exported Builder layout metadata are dropped so the project opens in
any business group. The workshop endpoints are kept as shipped.

The architecture diagram shown on the Builder landing page,
`public/images/vogue-premiere-workshop-diagram.png`, is MuleSoft's own workshop
artwork, copied from
[`broker-ui-diagram-bg.png`](https://actionability.workshops.mulesoft.com/_images/broker-ui-diagram-bg.png).

## AgentScript npm packages

**Location:** `package.json` dependencies (`@sf-agentscript/*`)

Parser, dialect, and graph utilities are consumed from the public npm registry,
not vendored from internal MuleSoft source trees. See each package on
[npmjs.com](https://www.npmjs.com/) for its license and terms.
