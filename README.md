



## JavaScript Utilities for DexLabs and General Purpose Framework

This repo contains JavaScript utilities for frontend enhancements including:

- **autosave.js**: Automatically saves state including input, textarea, radios to localStorage.
- **fullscreen.js**: Enable fullscreen mode on double-tap.
- **noteapp**: Personal note-taking app.
- **diffapp**: Personal diff-checker app.
- **codeblock.js**: syntax highlight any language with minimal setup.
- **preprocessor.js**: Split large HTML file into multiple parts and bind them together.

---

## Features & Usage

### 1. autosave.js

Automatically saves states localStorage.

Usage Example:

```html
<input id="customername" placeholder="Enter customer name"/>
<textarea id="notes" placeholder="Write your notes"></textarea>
```

Both gets autosaved to user's localStorage. Important: Each element must have a unique ID for autosaving.

Install via -

```html
<script src="https://cdn.jsdelivr.net/gh/vkdatta/web@main/app/dexsins/dexsinsjs/autosave.js"></script>
```
---

### 2. fullscreen.js

- Double-tap anywhere on the page to toggle fullscreen mode.
- Works on desktops and mobile devices.

Install via -

```html
<script src="https://cdn.jsdelivr.net/gh/vkdatta/web@main/app/dexsins/dexsinsjs/fullscreen.js"></script>
```
---

### 3. noteapp

Personal note-taking app. 

Access via - 

```
https://dex-labs.blogspot.com/
```
---

### 4. DiffApp

Personal diff-checker app.

Access via - 

```
https://dex-labs.blogspot.com/
```
---

### 5. codeblock.js

Drop the heavy Prism setup. Just include the codeblock.js script in your template and it handles everything. You only need to paste the script once. After that, it detects the file extension and applies syntax highlighting automatically. No extra Prism scripts required. It works with most Prism-supported languages out of the box and defaults to a dark theme. If you want a light theme, just override the styles using !important. No need for manual pre tags or extra configuration.

Usage Example:

```html
<code lang="py">your python code</code>
```

```html
<code lang="js">your javascript code</code>
```

> __Warning:__ This only supports adding code blocks in HTML. Directly injecting text into code blocks via JavaScript requires manipulating the .code-content query selector. You also need to use :not() to include unsupported languages.

Install via -

```html
<script src="https://cdn.jsdelivr.net/gh/vkdatta/web@main/app/dexsins/dexsinsjs/codeblock.js"></script>
```

### 6. preprocessor.js 

preprocessor.js is extremely useful when working with large HTML files that become difficult to maintain and scale. By splitting sections of HTML into different HTML files or creating a file for repeated UI sections into smaller reusable chunks, you avoid duplication and keep your main files clean and readable. Instead of editing the same structure in multiple places, you update it once and reuse it everywhere. The data-* binding mechanism allows small variations (like titles, descriptions, or buttons) without breaking the shared structure. This makes development faster, reduces errors, and creates a modular system similar to components in modern frameworks without needing any build tools or libraries.

Without preprocessor: 

```html
<!-- index.html -->
<div class="article-card">
  <div class="article-header">
    <h2>Why Remote Work Is Reshaping Cities</h2>
    <span class="author">By Ananya Rao</span>
  </div>
  <div class="article-body">
    <p>As remote work rises, smaller cities are seeing unexpected growth.</p>
    <p>Published in the Weekly Insight journal.</p>
    <p>Estimated reading time: 4 minutes.</p>
    <p>Category: Technology & Society.</p>
    <p>This article explores real-world implications.</p>
    <p>Includes expert opinions and data points.</p>
    <p>Updated regularly with new findings.</p>
    <p>Trusted by over 50,000 readers monthly.</p>
  </div>
  <div class="article-footer">
    <button>Read Full Article</button>
  </div>
</div>

<div class="article-card">
  <div class="article-header">
    <h2>The Rise of AI in Everyday Apps</h2>
    <span class="author">By Rahul Verma</span>
  </div>
  <div class="article-body">
    <p>From keyboards to photo editors, AI is quietly becoming part of daily life.</p>
    <p>Published in the Weekly Insight journal.</p>
    <p>Estimated reading time: 4 minutes.</p>
    <p>Category: Technology & Society.</p>
    <p>This article explores real-world implications.</p>
    <p>Includes expert opinions and data points.</p>
    <p>Updated regularly with new findings.</p>
    <p>Trusted by over 50,000 readers monthly.</p>
  </div>
  <div class="article-footer">
    <button>Read Full Article</button>
  </div>
</div>

<div class="article-card">
  <div class="article-header">
    <h2>Electric Vehicles Are Changing Urban Transport</h2>
    <span class="author">By Sneha Kapoor</span>
  </div>
  <div class="article-body">
    <p>EV adoption is accelerating as cities push for cleaner mobility.</p>
    <p>Published in the Weekly Insight journal.</p>
    <p>Estimated reading time: 4 minutes.</p>
    <p>Category: Technology & Society.</p>
    <p>This article explores real-world implications.</p>
    <p>Includes expert opinions and data points.</p>
    <p>Updated regularly with new findings.</p>
    <p>Trusted by over 50,000 readers monthly.</p>
  </div>
  <div class="article-footer">
    <button>Read Full Article</button>
  </div>
</div>

<div class="article-card">
  <div class="article-header">
    <h2>How Startups Are Redefining Finance</h2>
    <span class="author">By Arjun Mehta</span>
  </div>
  <div class="article-body">
    <p>Fintech startups are simplifying banking and investments globally.</p>
    <p>Published in the Weekly Insight journal.</p>
    <p>Estimated reading time: 4 minutes.</p>
    <p>Category: Technology & Society.</p>
    <p>This article explores real-world implications.</p>
    <p>Includes expert opinions and data points.</p>
    <p>Updated regularly with new findings.</p>
    <p>Trusted by over 50,000 readers monthly.</p>
  </div>
  <div class="article-footer">
    <button>Read Full Article</button>
  </div>
</div>
```

With preprocessor:

```html
<!-- article-card.html -->

<div class="article-card">
  <div class="article-header">
    <h2>{{title}}</h2>
    <span class="author">{{author}}</span>
  </div>
  <div class="article-body">
    <p>{{summary}}</p>
    <p>Published in the Weekly Insight journal.</p>
    <p>Estimated reading time: 4 minutes.</p>
    <p>Category: Technology & Society.</p>
    <p>This article explores real-world implications.</p>
    <p>Includes expert opinions and data points.</p>
    <p>Updated regularly with new findings.</p>
    <p>Trusted by over 50,000 readers monthly.</p>
  </div>
  <div class="article-footer">
    <button>Read Full Article</button>
  </div>
</div>
```

```html
<!-- index.html -->
<dextools-import 
  src="article-card.html"
  data-title="Why Remote Work Is Reshaping Cities"
  data-author="By Ananya Rao"
  data-summary="As remote work rises, smaller cities are seeing unexpected growth.">
</dextools-import>

<dextools-import 
  src="article-card.html"
  data-title="The Rise of AI in Everyday Apps"
  data-author="By Rahul Verma"
  data-summary="From keyboards to photo editors, AI is quietly becoming part of daily life.">
</dextools-import>

<dextools-import 
  src="article-card.html"
  data-title="Electric Vehicles Are Changing Urban Transport"
  data-author="By Sneha Kapoor"
  data-summary="EV adoption is accelerating as cities push for cleaner mobility.">
</dextools-import>

<dextools-import 
  src="article-card.html"
  data-title="How Startups Are Redefining Finance"
  data-author="By Arjun Mehta"
  data-summary="Fintech startups are simplifying banking and investments globally.">
</dextools-import>
```
Install via -

```html
<script src="https://cdn.jsdelivr.net/gh/vkdatta/web@main/app/dexsins/dexsinsjs/preprocessor.js"></script>
```
