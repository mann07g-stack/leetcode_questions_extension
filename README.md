# leet Questions

Stop losing your progress and start building your developer portfolio. leet Questions automatically pushes your accepted LeetCode solutions to a GitHub repository of your choice. Every time you hit "Submit" and pass, your code is committed and organized, turning your daily practice into a visible streak of contributions on your GitHub profile.

## Project Structure

- `src/html` for extension pages
- `src/css` for stylesheets
- `src/js` for popup, background, and content scripts
- `manifest.json` at repository root

## NPM Tooling

```bash
npm install
npm run format
npm run lint
```

## GitHub OAuth Setup (User-Self Auth)

Every user should create their own GitHub OAuth app and enter their own credentials in the extension popup.

1. Open `https://github.com/settings/developers`
2. Go to OAuth Apps and click New OAuth App
3. Use any app name (for example: leet Questions)
4. Set Authorization callback URL to exactly `https://github.com/`
5. Create the app and copy Client ID and Client Secret
6. Open extension popup and expand OAuth App Setup
7. Paste Client ID and Client Secret
8. Click Save OAuth Credentials
9. Click Connect GitHub and authorize

### Required Permissions

The extension requests the `repo` scope which grants:
- Access to **public and private repositories** you own
- Ability to **create new repositories**
- Ability to **push code and commits** to your repositories

This scope is necessary to provide full functionality including private repo access and repo creation. The extension only uses these permissions to save your LeetCode solutions.

## Extension Setup

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked and choose this repository folder
4. Open the extension popup and connect GitHub using your own OAuth app credentials
5. Select an existing repository or create a new repository
6. Save settings

## What Gets Saved

- Problem metadata and statement to `<folder>/<problem-slug>/README.md`
- Solution code to `<folder>/<problem-slug>/solution.<ext>`

## Temporary Logo

Current icon file is `assets/image.jpg` as a temporary placeholder.
Replace this file with your final logo image when ready.
