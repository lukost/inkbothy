---
# Post template: a stream or list section that uses categories and tags.
# Copy to <site>/<section>/<slug>/index.md (<slug> = lower-kebab-case directory name = URL /<section>/<slug>/).
title: "Post title"
summary: "One or two sentences: meta description, listings and search."
published: 2026-01-01              # YYYY-MM-DD, always set by hand
updates:                           # optional; one entry per change, the newest date is the updated date
  - { date: 2026-01-02, note: "What changed, in one line" }
categories: [General]              # flat; only if the section lists categories in `taxonomies`
tags: [example]                    # only if the section lists tags in `taxonomies`
draft: false                       # true = kept out of the published site
# toc: true                        # force the table of contents on or off (default: automatic, 3+ h2/h3)
# copyright: "Notice shown in the article footer, also when printed."
---

Body in Markdown. Images live next to this file and are referenced relatively,
e.g. `![Diagram](diagram.png)`.
