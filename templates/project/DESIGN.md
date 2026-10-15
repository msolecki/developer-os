---
version: alpha
name: "<Project name>"
description: "<One line: what the product looks like and for whom.>"
colors:
  primary: "#1A1C1E"
  on-primary: "#FFFFFF"
  surface: "#FFFFFF"
  on-surface: "#1A1C1E"
  error: "#B3261E"
typography:
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
rounded:
  sm: 4px
  md: 8px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
  button-primary-hover:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.on-primary}"
---

<!-- The design system in the DESIGN.md format (github.com/google-labs-code/design.md). Agents take
     every value from the tokens above; when the prose below and a token disagree, the token wins.
     Replace the placeholder values with the project's own. Check it with
     `npx @google/design.md lint DESIGN.md`. -->

## Overview

<!-- The product's visual character in two or three sentences: audience, tone, density. -->

## Colors

<!-- One line per role, as a rule: "primary is for the main call to action only, never for
     body text or decoration." -->

## Typography

<!-- Which style is for what: body for running text, heading for page and section titles. -->

## Layout

<!-- Grid, spacing scale use, and responsive behavior: breakpoints and what changes at each. -->

## Elevation & Depth

<!-- Shadows or borders, and which surfaces use them. -->

## Shapes

<!-- Corner radius per component family. -->

## Components

<!-- Each component token above, with its states and when to use it. -->

## Do's and Don'ts

<!-- Hard rules an agent must not break, written as "X is for Y only, never Z". -->
