# Upload test

Stands in for a project uploaded through the website, so the Factory's "uploaded project" route can be tried without the website.

- `transcript.zip`: the project as a maker would upload it (the transcript converter from `analyzer/testdata/transcript-python/`, plus a small sample transcript).
- `analyzer-result.json`: the Analyzer's answer for that zip. This one was written by hand in the Analyzer's format.
- `sample.json`: known-good inputs for the Factory's test run.

## Build it on GitHub

On the repository's **Actions** tab, choose **Build apps**, click **Run workflow**, and fill in:

| Field | Value |
|---|---|
| build_id | `upload-test-1` |
| project_url | `https://raw.githubusercontent.com/akondreddy/SimplyOpen/main/examples/upload_test/transcript.zip` |
| app_url | `https://raw.githubusercontent.com/akondreddy/SimplyOpen/main/examples/upload_test/analyzer-result.json` |
| sample_url | `https://raw.githubusercontent.com/akondreddy/SimplyOpen/main/examples/upload_test/sample.json` |

When the run finishes, the apps are on the repository's **Releases** page under `build-upload-test-1`.

## Build it on your own computer

From the `runner` folder:

```
npm run fetch-project -- ../examples/upload_test/transcript.zip ../examples/upload_test/analyzer-result.json ../examples/upload_test/sample.json
npm run stage -- resources/upload
npm run package
npm run smoke
```
