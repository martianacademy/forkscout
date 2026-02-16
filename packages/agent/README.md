# BTC/USDT TradingView Chart Screenshot

This repository contains a simple Python script that captures a screenshot of the BTC/USDT chart from TradingView.

## Files

- `requirements.txt` – Python dependencies (`selenium` and `webdriver-manager`).
- `screenshot_btcusdt.py` – The script that opens the TradingView chart in a headless Chrome browser and saves a PNG screenshot (`btcusdt_chart.png`).
- `README.md` – This documentation.

## Prerequisites

- Python 3.7+ installed.
- Google Chrome (or Chromium) installed on the system. The script uses Chrome in headless mode.

## Setup

```bash
# (Optional) Create a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

```bash
python screenshot_btcusdt.py
```

After the script finishes, you will find `btcusdt_chart.png` in the current directory.

## How it works

1. **Selenium WebDriver** is launched with Chrome in headless mode.
2. The script navigates to the TradingView chart URL for `BINANCE:BTCUSDT`.
3. It waits for the chart's `<canvas>` element to appear and then pauses briefly to ensure full rendering.
4. A screenshot of the entire page is saved as `btcusdt_chart.png`.
5. The browser is closed.

Feel free to modify the script (e.g., change the window size, URL, or output filename) to suit your needs.
