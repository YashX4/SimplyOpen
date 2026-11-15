# Urdu-English Word Frequency Analyzer

A bilingual Python text analyzer for studying word frequency in English and Urdu Roman text.

The tool reads text files, identifies words using regular expressions, calculates word frequencies, displays the most frequent words, and exports the results to CSV.

## Features

* **Bilingual Text Analysis** — processes English and Urdu Roman text.
* **Word-Frequency Analysis** — identifies and counts word occurrences.
* **Top-10 Results** — displays the ten most frequent words.
* **CSV Export** — saves analysis results to `results.csv`.
* **UTF-8 Support** — supports Urdu characters and multilingual text.
* **Command-Line Interface** — accepts text files directly from the terminal.

## Technologies

* Python 3
* Regular expressions (`re`)
* `collections.Counter`
* File I/O
* CSV
* UTF-8 text processing

## Project Structure

```text id="l9t4qp"
urdu-en-word-analyzer/
│
├── analyzer.py       # Main text analysis program
├── sample_en.txt     # English sample text
├── sample_urdu.txt  # Urdu sample text
├── results.csv       # Generated frequency results
├── .gitignore
├── LICENSE
└── README.md
```

## How It Works

1. Provide a `.txt` file to the program.
2. The program reads the file using UTF-8 encoding.
3. Regular expressions identify words in the text.
4. Word occurrences are counted.
5. The ten most frequent words are displayed.
6. Results are exported to `results.csv`.

## Usage

Analyze an English text file:

```bash id="8v3m0x"
python analyzer.py sample_en.txt
```

Analyze an Urdu text file:

```bash id="j6r2wa"
python analyzer.py sample_urdu.txt
```

## Example Use Cases

This project can be used as a simple foundation for:

* Exploring vocabulary in bilingual text
* Comparing word-frequency patterns across languages
* Studying Urdu Roman text
* Preparing text for further NLP experiments
* Learning fundamental text-processing techniques

## Limitations

This project performs frequency-based text analysis. It does not currently perform semantic analysis, machine learning, language modeling, translation, sentiment analysis, or large-language-model processing.

## License

This project is licensed under the MIT License.
