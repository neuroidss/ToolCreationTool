# Clone the repository (or install via npm if published)
# git clone ...
# cd ToolCreationTool

# Install dependencies
npm install

# Ensure ChromaDB is running (e.g., via Docker)
#docker run -p 8000:8000 chromadb/chroma

# Set environment variables (e.g., in a .env file or directly)
# Required for embeddings (using OpenAI's model here)
export OPENAI_API_KEY="your_openai_api_key"

# Optional: Configure LLM endpoint and model
export OPENAI_API_BASE="http://localhost:11434/v1" # Example for Ollama
export MODEL_NAME="qwen2.5-coder:7b-instruct-q8_0" # Example model
export CHROMA_URL="http://localhost:8000" # Default if not set

node index.js
