# Open-source visual references for EnglishCoach

Date: 2026-11-02. Scope: first-party repositories, product pages and documentation only. These are interface references for a mature learning product, not poster or campaign art. EnglishCoach is a React learning app with a daily queue, vocabulary practice, progress/evidence views and story reading; see [its learning specification](../specs/evidence-based-personalized-learning.md).

## Shortlist

### Qwerty Learner — closest React practice-screen reference

- Official repo: [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner); its README says it is React-based and describes vocabulary typing, IPA/audio, dictation, and live speed/accuracy feedback. The repo is [GPL-3.0](https://github.com/RealKai42/qwerty-learner/blob/master/LICENSE).
- Demo: [qwerty.kaiyi.cool](https://qwerty.kaiyi.cool/) or [GitHub Pages](https://realkai42.github.io/qwerty-learner/). The demo requires JavaScript. The official README has no static product screenshot URL, so a standalone screenshot was not available in the inspected primary sources.
- Borrow: a focused one-task practice surface, restrained instructional copy, clear word/pronunciation/input hierarchy, and immediate accuracy/progress feedback. This is the closest technical and interaction match for EnglishCoach's spelling and recall practice.
- Limits: the product is optimized for typing fluency and exam/API word lists; its interaction model is narrower than EnglishCoach's mixed study, evidence, story, and scenario workflows. Inspect its live practice screen before borrowing details.

### Enjoy — strong mature practice and vocabulary UI

- Official [Enjoy site](https://enjoy.bot/) separates Enjoy Echo, Enjoy Player and Enjoy Web. The [official web-app tour](https://docs.enjoy.bot/en/web/overview/) describes a shared sidebar for Home, Library, Craft, Vocabulary, Chat and Settings, with tabs for multi-page areas. The current [Enjoy Player source](https://github.com/baizhiheizi/enjoy_player), linked by the Player website, is AGPL-3.0 and uses Flutter. The legacy [everyone-can-use-english repository](https://github.com/ZuodaoTech/everyone-can-use-english) is GPL-3.0; neither license should be inferred for the current Enjoy Web app.
- Best direct official images: [desktop echo practice](https://player.enjoy.bot/images/desktop-echo.webp), [phone home](https://player.enjoy.bot/images/phone-home.webp), [phone vocabulary](https://player.enjoy.bot/images/phone-vocabulary.webp). The current Web app also has a live entry at [app.enjoy.bot](https://app.enjoy.bot/). The author’s [release issue #1322](https://github.com/ZuodaoTech/everyone-can-use-english/issues/1322) describes the newer Web app and advertises screenshots, but the inspected GitHub page did not expose their direct image URLs; use the official Player image assets above for verifiable screenshots.
- Borrow: persistent, quiet navigation; one main work area; contextual lookup beside media/text; a compact review card; and clear separation between daily goal, content and progress. These patterns make a product feel like a usable learning workspace rather than a promotional composition.
- Limits: Enjoy centers on media shadowing, pronunciation scoring and subscription/AI features. EnglishCoach can adopt its information hierarchy and practice framing without importing its media-player controls or commercial chrome.

### Lector — best reading and vocabulary-in-context reference

- Official [repo](https://github.com/heuwels/lector) and [product site](https://lector.dev/). The repo identifies the project as a language-learning reader with EPUB/YouTube, click-to-translate, cloze SRS and Anki sync; the repo is [AGPL-3.0](https://github.com/heuwels/lector/blob/master/LICENSE). The official site documents a vocabulary dashboard and word-state coloring in reading.
- Direct official images: [reader with word-state coloring](https://lector.dev/_astro/reader.yk5tcvhY_1j6mdD.webp), [cloze practice](https://lector.dev/_astro/cloze.Cg9PXzb6_ZOxQFA.webp). Live app: [lector.dev](https://lector.dev/).
- Borrow: comfortable reading measure, content-first typography, unobtrusive vocabulary state, click-to-lookup context, and transitions from reading into cloze practice. This is the strongest fit for EnglishCoach’s story-reading and comprehension flow.
- Limits: Lector is a self-hosted immersion reader with imported long-form material; EnglishCoach has short generated stories and a more guided daily plan. Its dense reader/library functions should not dictate the whole app shell.

### AppFlowy — secondary reference for workspace navigation only

- Official [repository](https://github.com/AppFlowy-IO/AppFlowy) describes a Notion-like workspace for docs, projects and databases, built with Flutter/Rust; it is [AGPL-3.0](https://github.com/AppFlowy-IO/AppFlowy/blob/main/LICENSE). Official web client: [AppFlowy-Web](https://github.com/AppFlowy-IO/AppFlowy-Web).
- Direct official product image: [project tracking](https://appflowy.com/_next/static/media/project-tracking.330c2889.webp). It is a first-party marketing-page product image, not a neutral capture of a learning screen.
- Borrow: sidebar organization, readable list/table density and calm document hierarchy if EnglishCoach needs more account/history/settings areas.
- Limits: project-management workspace with no learning loop or vocabulary pedagogy; the official main app repo is Flutter/Rust, so it is not a React implementation reference. Lower priority than Qwerty, Enjoy or Lector.

## Recommendation

Use Qwerty Learner for the focused study/retrieval surface, Enjoy’s official practice and vocabulary screenshots for mature navigation and status hierarchy, and Lector for stories and reading comprehension. Keep the visual treatment content-led: ordinary application chrome, consistent spacing, restrained color, clear progress and a single task focus. AppFlowy is optional for shell structure. Do not use marketing hero compositions as the model for in-app screens.

## Primary sources checked

- [Qwerty Learner README](https://github.com/RealKai42/qwerty-learner/blob/master/README.md) and [English README](https://github.com/RealKai42/qwerty-learner/blob/master/docs/README_EN.md)
- [Enjoy official site](https://enjoy.bot/), [Enjoy Web tour](https://docs.enjoy.bot/en/web/overview/), [Enjoy vocabulary guide](https://docs.enjoy.bot/en/learn/vocabulary/), [Enjoy Player product page](https://player.enjoy.bot/enhancecp), and [legacy repository/license](https://github.com/ZuodaoTech/everyone-can-use-english)
- [Lector official repo](https://github.com/heuwels/lector) and [official product site](https://lector.dev/)
- [AppFlowy official repo](https://github.com/AppFlowy-IO/AppFlowy), [AppFlowy-Web repo](https://github.com/AppFlowy-IO/AppFlowy-Web), and [official product site](https://appflowy.com/)
