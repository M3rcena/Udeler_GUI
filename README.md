# Udeler GUI - Udemy Course Downloader

A modern, cross-platform desktop application for downloading Udemy courses with a beautiful dark theme interface.

## ✨ Features

- **🎨 Modern Dark Theme** - Beautiful cyan-accented dark interface
- **📱 Cross-Platform** - Windows, macOS, and Linux support
- **🎥 Multiple Content Types** - Videos, articles, files, e-books, and audio
- **⚡ Individual Downloads** - Download specific lectures or entire courses
- **📊 Download Management** - Track and manage all your downloads
- **🌍 Multi-language Support** - Available in multiple languages
- **🔧 Customizable Settings** - Video quality, download paths, and more
- **⏸️ Pause/Resume** - Interrupt and resume downloads anytime
- **📁 Organized Downloads** - Automatic course and section organization

## 🚀 Quick Start

### 1. Download & Install

Download the latest version for your platform:

| Platform | Download |
|----------|----------|
| Windows | [Download Windows x64](https://github.com/M3rcena/Udeler_GUI/releases/latest) |
| macOS | [Download macOS](https://github.com/M3rcena/Udeler_GUI/releases/latest) |
| Linux | [Download Linux](https://github.com/M3rcena/Udeler_GUI/releases/latest) |

### 2. Get Your Udemy Access Token

Since Udemy has updated their authentication system, you'll need to manually obtain your access token:

#### Method 1: Using Browser Developer Tools (Recommended)

1. **Open your web browser** (Chrome, Firefox, Edge, etc.)
2. **Go to [Udemy.com](https://www.udemy.com)** and log in to your account
3. **Open Developer Tools**:
   - **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I` (Windows/Linux) / `Cmd+Option+I` (Mac)
   - **Firefox**: Press `F12` or `Ctrl+Shift+I` (Windows/Linux) / `Cmd+Option+I` (Mac)
4. **Go to the Network tab** in Developer Tools
5. **Refresh the page** or navigate to any course page
6. **Look for API requests** - filter by "api-2.0" or search for requests to `udemy.com/api-2.0`
7. **Click on any API request** and look for the "Authorization" header
8. **Copy the token** - it will look like: `Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...`

#### Method 2: Using Browser Console

1. **Log in to Udemy** in your browser
2. **Open Developer Tools** and go to the **Console** tab
3. **Run this command**:
   ```javascript
   console.log(localStorage.getItem('access_token') || 'Token not found in localStorage');
   ```
4. **Copy the token** if found

#### Method 3: Using Browser Extensions

1. **Install a cookie/header viewer extension** like "Cookie Editor" or "Header Editor"
2. **Navigate to Udemy.com** and log in
3. **Use the extension** to view request headers and find the Authorization token

### 3. Use the Access Token

1. **Open Udeler GUI**
2. **Click "Login with Access Token"**
3. **Paste your access token** when prompted
4. **Click "Login"** to access your courses

## 📖 Detailed Usage Guide

### Getting Started

1. **Launch the application** after installation
2. **Enter your access token** using the methods above
3. **Browse your courses** - all your enrolled courses will appear
4. **Click "Download"** on any course to see available content
5. **Select individual lectures** or use "Download All" for entire courses

### Download Options

- **Video Quality**: Choose from available qualities (720p, 1080p, etc.)
- **Download Range**: Set start and end points for course downloads
- **File Types**: Download videos, articles, PDFs, and other course materials
- **Organization**: Files are automatically organized by course and section

### Settings

Access settings via the gear icon to configure:
- **Download Path**: Choose where files are saved
- **Video Quality**: Set default quality preference
- **Language**: Change interface language
- **Download Options**: Configure retry, subtitle, and attachment settings

## 🛠️ For Developers

### Prerequisites

- Node.js (v20 or higher)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/M3rcena/Udeler_GUI.git
cd Udeler_GUI

# Install dependencies
npm install

# Start the application
npm start
```

### Building

```bash
# Build for current platform
npm run dist

# Build for specific platforms
npm run build-win    # Windows
npm run build-mac    # macOS
npm run build-linux  # Linux

# Build for all platforms
npm run build
```

### Development

```bash
# Start in development mode
npm start

# Run with hot reload
npm run dev
```

## 🔧 Troubleshooting

### Common Issues

**"Invalid Access Token" Error**
- Ensure you're copying the full token (starts with `Bearer `)
- Check that your Udemy account is active
- Try logging out and back into Udemy, then get a fresh token

**"No Courses Found" Error**
- Verify your access token is correct
- Ensure you have enrolled courses in your Udemy account
- Check your internet connection

**Download Failures**
- Some videos may be DRM-protected and cannot be downloaded
- Check your download path has sufficient space
- Verify your internet connection is stable

**Login Issues**
- Clear browser cache and cookies
- Try using a different browser
- Ensure you're not using a VPN that blocks Udemy

### Getting Help

1. **Check existing issues** on GitHub
2. **Search for similar problems** in the discussions
3. **Create a new issue** with detailed information:
   - Your operating system and version
   - Udeler GUI version
   - Steps to reproduce the problem
   - Error messages (if any)

## 📋 System Requirements

- **Windows**: Windows 10 or later (64-bit recommended)
- **macOS**: macOS 10.14 or later
- **Linux**: Ubuntu 18.04+, Fedora 28+, or similar
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 1GB free space for application + space for downloads

## 🔒 Privacy & Security

- **No data collection**: Udeler GUI doesn't collect or transmit any personal data
- **Local storage**: All settings and data are stored locally on your device
- **Secure authentication**: Uses official Udemy API with your access token
- **Open source**: Full transparency with publicly available source code

## ⚖️ Legal Disclaimer

This software is intended for **personal use only** to download courses you have legally purchased on Udemy. 

**Important:**
- Only download courses you have enrolled in
- Do not share downloaded content with others
- Respect Udemy's Terms of Service and copyright laws
- This tool automates the same process you could do manually in a browser

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and test thoroughly
4. **Commit your changes**: `git commit -m 'Add amazing feature'`
5. **Push to the branch**: `git push origin feature/amazing-feature`
6. **Open a Pull Request**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Original Developer**: Faisal Umair for creating the initial Udeler project
- **Contributors**: All community members who have contributed to this project
- **Udemy**: For providing the platform and API that makes this possible

## 💝 Support the Project

If you find this project helpful, please consider:

- ⭐ **Starring the repository**
- 🐛 **Reporting bugs** and issues
- 💡 **Suggesting new features**
- 📝 **Contributing code** or documentation
- 🗣️ **Sharing with others** who might find it useful

---

**Note**: This is a community-maintained fork of the original Udeler project, updated with modern features and improved user experience while maintaining the core functionality.

**Made with ❤️ by M3rcena**
