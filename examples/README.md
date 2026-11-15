# Examples

Small projects that have no screen of their own: each one is a single Python script that only works from a command line. They are here to try SimplyOpen on (uploading, opening, copying, changing through chat) and to fill the site for demos.

| Folder | Name | What it does |
|---|---|---|
| [`bar_chart_maker`](bar_chart_maker) | Bar Chart Maker | Draw a bar chart picture from a two-column list of names and numbers. |
| [`bingo_card_maker`](bingo_card_maker) | Bingo Card Maker | Make printable bingo cards from your own list of words. Every card is shuffled differently. |
| [`calendar_maker`](calendar_maker) | Calendar Maker | Make a printable one-page calendar for any month of any year. |
| [`color_palette`](color_palette) | Colour Palette Maker | Build a matching set of lighter and darker shades from one colour. |
| [`csv_cleaner`](csv_cleaner) | Spreadsheet Cleaner | Tidy a messy spreadsheet file: trims stray spaces and removes empty and repeated rows. |
| [`csv_merger`](csv_merger) | Spreadsheet Joiner | Join several spreadsheet files into one, even when their columns differ. |
| [`csv_to_json`](csv_to_json) | Spreadsheet to JSON | Turn a spreadsheet file into a JSON file, the format many websites and apps ask for. |
| [`duplicate_finder`](duplicate_finder) | Duplicate File Finder | Find files in a folder that are exact copies of each other, so you can free up space. |
| [`email_extractor`](email_extractor) | Email Address Finder | Pull every email address out of a document and list each one once. |
| [`expense_summary`](expense_summary) | Expense Summary | Add up a list of expenses by category and by month to see where the money went. |
| [`file_renamer`](file_renamer) | Batch File Renamer | Make neatly numbered copies of every file in a folder, like holiday_001, holiday_002. |
| [`find_replace`](find_replace) | Find and Replace | Swap one word or phrase for another everywhere in a text file. |
| [`flashcard_maker`](flashcard_maker) | Flashcard Maker | Turn a list of questions and answers into study cards you can click to flip, or print. |
| [`folder_organizer`](folder_organizer) | Folder Organizer | Sort a messy folder into tidy folders by type: Pictures, Documents, Music and so on. |
| [`grade_calculator`](grade_calculator) | Grade Calculator | Work out each student's average and letter grade from a sheet of scores. |
| [`group_maker`](group_maker) | Group Maker | Split a list of names into fair random groups for class projects, teams or seating. |
| [`image_resizer`](image_resizer) | Image Resizer | Make a picture smaller or larger without stretching it. |
| [`invoice_maker`](invoice_maker) | Invoice Maker | Turn a list of items and prices into a printable invoice with the totals worked out. |
| [`loan_calculator`](loan_calculator) | Loan Calculator | Work out the monthly payment on a loan and see every payment until it is paid off. |
| [`log_summarizer`](log_summarizer) | Log Summarizer | Read a long program log and see how many errors and warnings it has and which come up most. |
| [`mail_merge`](mail_merge) | Letter Maker | Write one personal letter per person from a single letter and a list of people. |
| [`markdown_to_html`](markdown_to_html) | Notes to Web Page | Turn simple formatted notes (Markdown) into a web page you can open, share or print. |
| [`maze_maker`](maze_maker) | Maze Maker | Draw a random maze to print and solve with a pencil. Pick how big it is. |
| [`password_generator`](password_generator) | Password Generator | Make a list of strong random passwords, saved to a file on your own computer. |
| [`readability_checker`](readability_checker) | Readability Checker | Score how easy a piece of writing is to read and find the sentences worth splitting. |
| [`recipe_scaler`](recipe_scaler) | Recipe Scaler | Make a recipe bigger or smaller: every amount is multiplied for you. |
| [`subtitle_shifter`](subtitle_shifter) | Subtitle Shifter | Move every subtitle earlier or later when the words do not line up with the video. |
| [`survey_tally`](survey_tally) | Survey Tally | Count the answers to each question in a survey and see them as simple bars. |
| [`text_compare`](text_compare) | Document Compare | See what changed between two versions of a document, side by side. |
| [`tip_calculator`](tip_calculator) | Tip Calculator | A web page, the kind Claude makes as an HTML artifact. Shown in the app's window as it is. |
| [`timesheet_totals`](timesheet_totals) | Timesheet Totals | Add up the hours each person worked from start and finish times, with pay if you like. |
| [`todo_list`](todo_list) | Simple To-Do List | A React component, the kind Claude makes as a React artifact. The Factory builds it into a page first. |
| [`word_counter`](word_counter) | Word Counter | Count how often each word appears in a piece of writing. |

[`from_github`](from_github) holds thirty more projects copied from public GitHub repositories, with their own README; unlike the ones above they have not been run and most need packages installed.

`upload_test` is different: it is a ready-made upload for trying the Factory, described in its own README.

## What is in each folder

- one script (the project itself)
- `sample/`: a small input to try it with, where the project reads a file or folder
- `simplyopen.json`: the name, description and manifest (format 1.0) the Runner reads
- `simplyopen.sample.json`: answers that are known to work, for a test run

Every Python project except `image_resizer` uses only what comes with Python 3.9 or newer, so nothing has to be installed. Each one saves its result into the folder given by `--output-dir` and never changes its input.

## Loading them on the website

The website takes a project as one zip in the upload form. `uploads/` holds that zip for every example (61 in all), so any of them can be uploaded as it is.

`uploads/index.json` lists, for each one, the three addresses the Factory's **Build apps** workflow asks for: `project_url` (the zip), `app_url` (the project's `simplyopen.json`) and `sample_url` (its `simplyopen.sample.json`, where there is one). The addresses point at the `main` branch, so they work once this folder is merged.

After changing an example, rebuild the zips with:

```
python3 examples/make_uploads.py
```

## Trying one by hand

```
cd examples/recipe_scaler
python3 scale.py sample/pancakes.txt --times 2 --output-dir out
```

Run any script with `--help` to see its options.
