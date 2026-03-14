# LeetCode Questions Extension

Chrome extension (Manifest V3) to capture the current LeetCode problem and save it to GitHub.

## What It Saves
- Problem metadata and statement to:
  - `<folder>/<problem-slug>/README.md`
- Your current editor code (if detected) to:
  - `<folder>/<problem-slug>/solution.<ext>`

## What You Must Add
1. A GitHub personal access token
   - Classic token: include `repo` scope
   - Fine-grained token: give `Contents` read/write on the target repo
2. A target repository in `owner/repo` format
3. Optional branch name (defaults to `main`)
4. Optional folder name (defaults to `problems`)

## Extension Setup
1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked and choose this repository folder
4. Open the extension popup and fill:
   - GitHub token
   - Repository (`owner/repo`)
   - Branch (optional)
   - Folder (optional)
5. Click Save Settings

## Usage
1. Open a LeetCode problem page (example: `https://leetcode.com/problems/two-sum/`)
2. Ensure your code is visible in the editor
3. Click the extension icon
4. Click Save Current Problem

## Notes
- If code is not detected, the extension still saves README and reports that solution was not found.
- If LeetCode updates its DOM/editor internals, selectors or extraction logic in `scripts/content.js` may need an update.
