#!/bin/bash
# Change directory to the directory where this script is located
cd "$(dirname "$0")"

# Set up Node.js path
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"

# Wait a brief moment and open the browser in the background
(sleep 2 && open http://localhost:3000) &

# Run the next.js development server
npm run dev
