---
template: post
title: "Fortémi React — April 2026"
date: 2026-04-01
author: Fortémi Team
summary: "A quiet month with one solid step forward: fortemi-react learned to use AI models from more places — a remote service, a local one on your own machine, or a fallback between them — and the React package became lighter and easier to drop into an app."
tags: [report, fortemi-react, "2026-04", agent-memory]
---

# fortemi-react — April 2026

*fortemi-react is the Fortemi memory service, built to run inside your web browser. Fortemi keeps notes for an AI agent and lets the agent search them by meaning. fortemi-react does that same job with no separate server — it all runs in the browser, on your computer. (It is the server in the browser. HotM, a different project, is a client that talks to the server.)*

## TL;DR

April was a quiet month — and that's fine, some months are. The main step forward: fortemi-react learned to get its AI from more than one place. It can use a **remote** AI service over the network. It can use a **local** one on your own machine. Or it can **fall back** from one to the other if the first isn't available. The React package also got lighter. It stopped shipping its own copy of React and now uses the app's, so it's easier and cleaner to drop in. No public release went out this month; the first packages shipped to npm in May.

## By the numbers

| What's public | Value |
|---|---|
| npm packages | none yet — first public release shipped in May |
| New this month | more ways to get AI: remote, local, or fallback |
| React package | lighter — no longer bundles its own copy of React |
| Source | github.com/Fortemi/fortemi-react |

## Highlights

**1. Get your AI from anywhere — remote, local, or a fallback between them.**
What it is: a shared way to plug in an AI model. It can talk to a remote service over the network. It can talk to a local one on your own computer, like Ollama or LM Studio. Or it can try one and quietly fall back to the other.
How you'd use it: point fortemi-react at whichever AI setup you have, and it uses it. If the first choice is down, it can switch to the backup on its own.
Why it helps: you're not locked to one AI provider. Use a cloud service, keep everything local for privacy, or mix the two — your choice.

**2. A lighter React package that drops in cleanly.**
What it is: the React part of fortemi-react no longer carries its own copy of React. It uses the copy your app already has.
How you'd use it: add it to an app and it fits in — no duplicate React, no version tug-of-war.
Why it helps: smaller downloads, fewer conflicts, and a cleaner fit into an existing app.

## Features shipped

**The inference provider system.** This was the month's main piece of work. "Inference" just means running an AI model to get an answer. fortemi-react gained a single, shared way to connect to a model. It comes in three built-in styles. A **remote** provider reaches a service over the network. A **local** provider runs a model on your own machine. And a **fallback** tries providers in order, so a hiccup with one doesn't stop the work. This is the groundwork that lets the same browser build run against a local model or a shared service — with no change to the rest of the app.

**A portable React package.** The React package was made portable. It stopped bundling its own copy of React. Now it uses the host app's copy instead. A no-host fallback path was added too, so it degrades gracefully when a feature isn't available. Regression tests keep that fallback behavior honest.

## Fixes

None called out this month beyond the portability work above — April was a small, focused month.

## Performance & reliability

The fallback design is itself a reliability feature: if one AI provider is unavailable, fortemi-react can move to the next instead of failing. Dropping the bundled React copy also trims what an app has to download.

## Breaking changes & migrations

None this month. The inference provider system is additive, and the React portability change is designed to fit existing apps rather than break them.

## Releases

None this month. Nothing was published to the public npm registry in April. The first public packages shipped in May.

## Dependencies & security

No security alerts needed fixing this month. Removing the bundled React copy means one fewer copy of a dependency to keep in step — a small but real simplification.

## Docs & developer experience

The project context notes were refreshed to match the new inference provider work, so the written picture of the code stayed accurate.

## Tests & CI

A test setup for the React package landed this month, along with regression tests for the no-host fallback path — the first tests aimed squarely at the React layer.

## Cross-project impact

- The inference provider system matters beyond the browser. It sets a pattern for connecting to remote services, local servers, and fallbacks. That keeps fortemi-react flexible about where its AI comes from.
- fortemi-react remains the **browser build of the Fortemi server**, and this month's work kept it on track toward its first public release.

## Known issues & open threads

- April was deliberately light. The bigger public moment — the first packaged release on npm — was set up and shipped the following month.
- The inference provider system landed as groundwork; more provider types and polish followed in later months.

## What's next

Package everything and ship the first public release to npm, with a proper signed release process behind it. That's the headline of May.

## Appendix

- **Published packages:** none yet in April — the first public releases came in May.
- **Source / docs:** github.com/Fortemi/fortemi-react · window: all of April 2026.
