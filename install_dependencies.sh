#!/bin/bash

# FindMy Bot - Dependency Installation Script
# Run this in your activated virtual environment

echo "Installing FindMy Bot dependencies..."
echo "Make sure you're in an activated virtual environment!"

# Core Python packages
echo "Installing Python packages..."
pip install flask
pip install pyautogui
pip install pytesseract
pip install opencv-python
pip install numpy
pip install pynput

echo ""
echo "Python packages installed successfully!"

# Check for Tesseract OCR (system dependency)
echo ""
echo "Checking for Tesseract OCR..."

if command -v tesseract &> /dev/null; then
    echo "✓ Tesseract OCR is already installed"
    tesseract --version
else
    echo "⚠️  Tesseract OCR not found!"
    echo ""
    echo "Please install Tesseract OCR for your system:"
    echo ""
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "On macOS (with Homebrew):"
        echo "  brew install tesseract"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "On Ubuntu/Debian:"
        echo "  sudo apt-get install tesseract-ocr"
        echo ""
        echo "On CentOS/RHEL/Fedora:"
        echo "  sudo dnf install tesseract"
    else
        echo "Please visit: https://github.com/tesseract-ocr/tesseract#installation"
    fi
    
    echo ""
    echo "After installing Tesseract, run this script again to verify."
    exit 1
fi

echo ""
echo "🎉 All dependencies installed successfully!"
echo ""
echo "Next steps:"
echo "1. Run: python findmy.py"
echo "2. Choose option 1 to setup configuration"
echo "3. Run: python web_host.py to start the web interface"
echo ""