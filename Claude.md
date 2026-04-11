# Jake's Pro Music & Audio Skills Center — Project Reference

> **This file is intended for Claude Code (or any AI assistant) to read before making changes to this site.** It contains the design specifications, site architecture, infrastructure details, and the full conversation history from the initial build session.

---

## Design Specifications Summary

### Brand & Identity
- **Business name:** Jake's Pro Music & Audio Skills Center *(placeholder — may change)*
- **Owner:** Jake Munch
- **Domain:** jakemunch.com
- **Tagline:** "Learn. Create. Sound Amazing."
- **Tone:** Professional but friendly and approachable — not corporate, not overly casual

### Color Palette
- **Background:** `#faf9f7` (warm off-white)
- **Background alt:** `#f0eee9` (light warm gray, used for credibility strip, gallery placeholders)
- **Surface:** `#ffffff` (cards, form fields)
- **Primary (copper/burnt orange):** `#c0622e` — used for CTAs, links, accents, logo icon
- **Primary dark:** `#a14e1f` — hover states
- **Primary light:** `#f5e6db` — subtle backgrounds, service note bars
- **Accent (teal green):** `#2a6b5a` — CTA band background, consulting card left borders
- **Accent light:** `#e0f0eb` — gallery instructions background
- **Text:** `#2c2c2c`
- **Text muted:** `#6b6b6b`
- **Headings:** `#1a1a1a`
- **Border:** `#e0ddd6`
- **Dark background (hero, page headers, footer):** `#1e2127`
- **Dark text:** `#e8e6e1`

### Typography
- **Headings:** `DM Serif Display` (Google Fonts), fallback Georgia, serif
- **Body:** `Libre Franklin` (Google Fonts), fallback -apple-system, sans-serif
- **Font weights used:** 300, 400, 500, 600, 700

### Layout & Spacing
- **Max content width:** 1120px
- **Border radius:** 8px (standard)
- **Container padding:** 0 24px
- **Card padding:** 32px 28px (service cards), 28px (sidebar cards), 24px (client/consult cards)
- **Section padding:** 64–80px vertical
- **Responsive breakpoints:** 768px (tablet/mobile nav), 480px (small mobile), 680px (about page grid)

### Component Patterns
- **Navigation:** Sticky top, frosted glass effect (`backdrop-filter: blur(12px)`), hamburger menu on mobile
- **Hero (home):** Dark gradient background with subtle dot pattern, centered content, two CTA buttons
- **Page headers (inner pages):** Dark gradient, centered h1 + subtitle
- **Service cards:** White background, 1px border, hover lifts with shadow + border color change to primary
- **Credibility strip:** Alt background, flex row of icon + text items
- **CTA bands:** Teal green background, white text, inverted button (white bg, teal text)
- **Footer:** Dark background matching hero, centered brand + links + copyright
- **Forms:** Labeled fields with focus ring in primary-light, required fields marked with copper asterisk
- **Testimonial cards:** Decorative oversized quote mark (primary-light), italic quote text, author name + role
- **Gallery:** Dashed-border placeholder boxes with 4:3 aspect ratio, organized by category
- **Consulting items:** Left border accent in teal green

### Animations
- **Hero content:** fadeInUp 0.8s
- **Cards:** fadeInUp 0.6s with staggered delays (0.1s increments per child)

### CSS Variables (defined in :root)
All colors, fonts, shadows, transitions, and radii are defined as CSS custom properties in `styles.css` for easy theming. Any changes to the palette should be made in `:root`.

---

## Site Architecture

### Pages
| File | Page | Notes |
|------|------|-------|
| `index.html` | Home | Hero, service overview cards (4), credibility strip, CTA |
| `about.html` | About | Bio, client highlights (4 orgs), Shure partnership, mentoring philosophy, credentials grid |
| `services.html` | Services | Three sections: Music Lessons (#lessons), Audio Engineering (#audio), Consulting (#consulting) |
| `testimonials.html` | Testimonials | 6 placeholder cards — replace with real quotes |
| `gallery.html` | Gallery | 4 categories with placeholder slots — replace with `<img>` tags |
| `contact.html` | Contact | Formspree-powered form (7 fields) + sidebar with quick info and "what to expect" |
| `styles.css` | Stylesheet | All styles for all pages, responsive |
| `nav.js` | Navigation | Mobile hamburger toggle script |

### Services Offered (as defined on the site)
**Music Lessons (Zoom & in-person):**
- Drumset — all genres, beginner → professional
- Classical percussion (snare, mallet, timpani) — beginner → collegiate
- Acoustic guitar (folk, blues, slide, rock) — beginner → collegiate
- Electric guitar (blues, rock, metal, R&B) — beginner → collegiate
- Piano/keyboard — all genres, beginner → intermediate

**Audio Engineering Instruction (Zoom & in-person):**
- Studio audio engineering/design — all genres, beginner → professional
- Live pro audio engineering/design — all formats, beginner → professional, emphasis on mixing and wireless tech

**Consulting & Sound Design (on-site, Greater Philadelphia):**
- Sound system assessment & design
- Theatrical production sound design
- Wireless & RF coordination
- Mentoring & training for student crews and volunteers

### Credentials Referenced on Site
- B.S. Jazz Performance, Temple University
- Working relationship with Shure Incorporated on expert-level troubleshooting
- Notable clients: Merion Mercy Academy (MMMT), Waldron Mercy Academy, St. Margaret School (Narberth, PA), Players Club of Swarthmore

### Contact Form Fields
1. Name (text, required)
2. Email (email, required)
3. Phone (tel, optional)
4. Interest (select, required) — options: Drum Lessons, Guitar Lessons, Piano/Keyboard Lessons, Classical Percussion Lessons, Studio Audio Engineering Instruction, Live Audio Engineering Instruction, Live Sound Consulting, Theater Sound Design, Other/Multiple Services
5. Preferred Format (select) — Zoom, In-Person, Either, N/A
6. Experience Level (select) — Beginner, Intermediate, Advanced, Professional, N/A
7. Message (textarea, required)

**Form backend:** Formspree (free tier, 50 submissions/month). Form action URL is in `contact.html`.

### Pricing Display
No rates displayed on site. All pricing is "Contact for pricing."

---

## Infrastructure

### Hosting
- **Platform:** GitHub Pages
- **Repository:** https://github.com/jakemunch/jakesite01
- **Branch:** main (root folder)
- **Deploy:** Automatic on push to main

### Domain
- **Domain:** jakemunch.com (registered and managed via Squarespace)
- **DNS Configuration (Squarespace → GitHub Pages):**
  - 4x A records: `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
  - 1x CNAME: `www` → `jakemunch.github.io`
  - 1x CNAME (Google verification, pre-existing): `sguwi25zqmyw` → `gv-puh2pvnfse3r6b.dv.googlehosted.com`
- **HTTPS:** Enforced via GitHub Pages (free certificate)
- **Squarespace Domain Connect preset:** Deleted (was conflicting with GitHub)

### Form Backend
- **Service:** Formspree (formspree.io)
- **Tier:** Free (50 submissions/month)
- **Integration:** HTML form `action` attribute in `contact.html`, POST method

---

## Outstanding Items / To-Do

- [ ] Confirm or update the contact email displayed in the sidebar (currently `jake@jakemunch.com`)
- [ ] Add headshot photo to About page (replace `.about-photo-placeholder` div with `<img>`)
- [ ] Add gallery photos (place in `images/` folder, replace `.gallery-placeholder` divs with `<img>` tags)
- [ ] Replace testimonial placeholder cards with real quotes (6 slots ready)
- [ ] Finalize business/brand name (currently "Jake's Pro Music & Audio Skills Center")
- [ ] Enforce HTTPS in GitHub Pages settings once certificate is issued

---

## Full Conversation History

Below is the complete conversation from the initial build session (April 11, 2026) for full context on design decisions, rationale, and owner preferences.

---

### Topic: Hosting Provider Selection

**Jake:** I want to launch a web site to enhance my side-business (Zoom-based music and audio technology lessons, and live sound consulting) online visibility and attract customers. I'll need your help to build the site, but first I need to learn how to get everything up and running. I already have a domain, jakemunch.com, which is paid for through Squarespace. But I don't know how to begin. Can you provide recommendations for a hosting provider (are there any free ones that are good, and if not, reasonably-priced ones are preferred), and also outline the steps to begin the process. Once we get the site working, I'll then ask you to help me design the content.

**Claude:** Recommended three free hosting options: GitHub Pages (best fit given Jake's Git comfort), Netlify, and Cloudflare Pages. Outlined the full deployment process: choose host → build site locally → deploy files → point domain via Squarespace DNS → enable HTTPS → iterate on content.

**Jake:** GitHub sounds like the right choice, but first one question. Although the site will absolutely host mostly static content, I do want the ability to let users request service information, etc. So maybe the ability for users to fill out and submit a form. Can I do that with GitHub?

**Claude:** Yes, with a workaround — recommended Formspree (free tier, 50 submissions/month) as the simplest option. HTML form posts to Formspree URL, which forwards to email. No backend needed.

**Jake:** Great, I think we'll go with Formspree for now. I have created a new repo on my public GitHub account with the Pages setting: https://github.com/jakemunch/jakesite01

---

### Topic: Site Design & Content Requirements

**Claude asked:** What services to highlight, overall tone, and how many pages.

**Jake answered:**
- Services: Zoom music lessons, Audio/sound technology lessons, Live sound consulting, Theater sound design/engineering (all four)
- Tone: Mix of professional and friendly
- Pages: Full site (Home, About, Services, Testimonials, Contact)

**Claude asked:** Instruments/topics taught, pricing display preference, brand name.

**Jake answered:**
- Instruments: Other (will describe)
- Pricing: Contact for pricing (no rates shown)
- Brand name: Something else (will specify)

**Jake provided detailed specifications:**
1. Teaching offerings: Drumset (all genres, beginner–pro), classical percussion (beginner–collegiate), acoustic guitar (folk/blues/slide/rock, beginner–collegiate), electric guitar (blues/rock/metal/R&B, beginner–collegiate), piano/keyboard (all genres, beginner–intermediate), studio audio engineering (all genres, beginner–pro), live pro audio engineering (all formats, beginner–pro, focus on mixing and wireless tech)
2. Brand name: "Jake's Pro Music and Audio Skills Center" (with option to change later)
3. Highlight work for MMMT, Waldron Mercy, St. Margaret School, Players Club of Swarthmore — emphasizing oversight, design, and mentoring reputation
4. Credentials: close working relationship with Shure Corporation on expert-level troubleshooting, B.S. Jazz Performance from Temple University
5. Testimonials from people on both pro audio and music performance sides
6. Wants imagery/gallery of studio and live audio work in action

**Claude asked:** Lesson delivery format and photo readiness.

**Jake answered:**
- Both Zoom and in-person equally
- Will upload photos later (use placeholders for now)

---

### Topic: Site Build

Claude built the complete 8-file site:
- `index.html` — Home page with hero, 4 service cards, credibility strip, CTA
- `about.html` — Bio, 4 client highlight cards, Shure partnership, mentoring philosophy, credentials grid
- `services.html` — Three sections with detailed instrument/topic cards
- `testimonials.html` — 6 placeholder testimonial cards
- `gallery.html` — 4 categories with placeholder image slots and instructions
- `contact.html` — 7-field Formspree form with sidebar
- `styles.css` — Complete responsive stylesheet
- `nav.js` — Mobile hamburger menu toggle

---

### Topic: Domain & DNS Setup

Claude provided step-by-step instructions for pointing jakemunch.com to GitHub Pages:
1. Push files to repo
2. Set custom domain in GitHub Pages settings to `www.jakemunch.com`
3. In Squarespace DNS: delete Squarespace Domain Connect preset, add 4 A records + 1 CNAME under Custom Records, leave Google verification record untouched
4. Wait for DNS propagation
5. Enforce HTTPS in GitHub Pages settings

Jake shared screenshots of the Squarespace DNS settings panel. Claude confirmed the configuration was correct after changes were made.

---

### Topic: Formspree Setup

Claude walked through: create account → create form → copy form ID → replace `YOUR_FORM_ID` in contact.html → push → test (first submission triggers email verification).

Jake confirmed the form works and DNS check is complete. HTTPS certificate was still being issued at end of session.

---

### Design Decisions & Rationale

- **Warm earth tone palette** chosen to feel approachable and creative without being garish — the copper primary evokes warmth/music, teal accent adds professionalism
- **DM Serif Display + Libre Franklin** pairing gives a refined but readable feel — serif headings for personality, clean sans body for scannability
- **Dark hero/headers** create visual weight at the top of each page and make the content sections feel bright and open by contrast
- **Four service cards on home page** give visitors an immediate overview without overwhelming — each links to the detailed services page
- **Credibility strip** between services and CTA gives social proof at a glance
- **Contact form with structured dropdowns** (service interest, format, experience level) helps Jake triage inquiries efficiently rather than getting vague messages
- **Sidebar "What to Expect" steps** reduce friction for visitors who might be hesitant to reach out
- **Gallery organized by category** (Live Sound, Studio, Teaching, Gear) rather than a flat grid to tell a more complete story
- **Testimonials as a separate page** rather than embedded on home page — gives room for a meaningful collection as they accumulate
- **No pricing displayed** — Jake prefers to discuss pricing in conversation to tailor to the client
