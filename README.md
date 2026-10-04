# Copilot Transcript Cleaner

A browser-based version of the Node.js Copilot saved-page transcript extractor.

## Run on Replit

1. Create a new Replit app using the HTML/CSS/JS template.
2. Replace the generated files with:
   - `index.html`
   - `style.css`
   - `script.js`
3. Click Run.
4. Upload Copilot `.html`, `.htm`, `.txt`, or `.json` exports.
5. Choose **Plain text** and/or **Include header** if desired.
6. Click **Convert files**.
7. Download the resulting `_transcript.txt` files.

No server or npm packages are required.

## Privacy

The conversion happens entirely in the browser. Uploaded files are read with the browser File API and are not sent to a backend by this app.

## Original CLI options

The original:
- `--plain` -> the **Plain text** checkbox
- `--header` -> the **Include header** checkbox
- multiple input files -> multi-file upload
- output beside each source file -> browser downloads named `*_transcript.txt`
