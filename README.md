# Tool Creation Tool (JavaScript)

A JavaScript library enabling Large Language Model (LLM) agents to dynamically create and manage their own tools (functions) using a Retrieval-Augmented Generation (RAG) approach with ChromaDB. This allows agents to extend their capabilities based on user requests or contextual needs.

This library provides the core `ToolCreationTool`, which is an LLM tool specifically designed to generate the definitions of *other* tools.

## Features

*   **Dynamic Tool Creation:** Allows an LLM to generate new tool definitions (name, description, JSON parameter schema) based on natural language descriptions.
*   **RAG Storage:** Stores tool definitions in a ChromaDB vector database.
*   **Contextual Tool Retrieval:** Provides agents with a list of tools relevant to the current conversation context, queried from ChromaDB.
*   **Core Tool Priority:** Ensures the `ToolCreationTool` itself is always available and listed first for the agent.
*   **Self-Healing Core Tool:** Automatically adds the `ToolCreationTool` definition to ChromaDB if it's missing.
*   **API Agnostic:** Designed to work with OpenAI-compatible APIs (Ollama, vLLM, DeepSeek, OpenRouter, standard OpenAI).
*   **Minimal File Structure:** Core logic consolidated for easier integration.

## Installation

```bash
# Clone the repository (or install via npm if published)
# git clone ...
# cd ToolCreationTool

# Install dependencies
npm install

# Ensure ChromaDB is running (e.g., via Docker)
# docker run -p 8000:8000 chromadb/chroma

# Set environment variables (e.g., in a .env file or directly)
# Required for embeddings (using OpenAI's model here)
export OPENAI_API_KEY="your_openai_api_key"

# Optional: Configure LLM endpoint and model
export OPENAI_API_BASE="http://localhost:11434/v1" # Example for Ollama
export MODEL_NAME="qwen2.5-coder:7b-instruct-q8_0" # Example model
export CHROMA_URL="http://localhost:8000" # Default if not set
```

## Usage
The library centers around the ToolManager class, which handles ChromaDB interactions and tool management, and requires an LLM client instance (like the one from the openai package) to execute the tool creation process.

```javascript
import OpenAI from 'openai';
import { ToolManager } from './toolManager.js'; // Adjust path as needed

// 1. Configure LLM Client (OpenAI Compatible)
const llmClient = new OpenAI({
    baseURL: process.env.OPENAI_API_BASE || 'http://localhost:11434/v1',
    apiKey: process.env.OPENAI_API_KEY || 'ollama',
});
llmClient.model = process.env.MODEL_NAME || 'qwen2.5-coder:7b-instruct-q8_0';

// 2. Initialize Tool Manager
// Pass the LLM client for use by the ToolCreationTool's execution logic
const toolManager = new ToolManager(llmClient);

// 3. (Optional but Recommended) Initialize connection and ensure core tool exists
try {
    await toolManager._getOrCreateCollection();
    console.log("Tool Manager initialized.");
} catch (error) {
    console.error("Initialization failed:", error);
    // Handle error appropriately
}


// --- Agent Interaction Loop (Conceptual Example) ---

async function handleUserInput(userInput) {
    // a. Get relevant tools for the current context
    // ToolManager automatically includes and prioritizes 'create_new_tool'
    const availableTools = await toolManager.getAvailableTools(userInput, 5); // Get top 5 + core tool

    // b. Format tools for the LLM API (e.g., OpenAI format)
    const toolsForLLM = availableTools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));

    // c. Call the main LLM with the user query and available tools
    const response = await llmClient.chat.completions.create({
        model: llmClient.model,
        messages: [
            { role: 'system', content: 'You are a helpful assistant. Use tools when needed.' },
            { role: 'user', content: userInput }
        ],
        tools: toolsForLLM.length > 0 ? toolsForLLM : undefined,
        tool_choice: 'auto',
    });

    const message = response.choices.message;

    // d. Check if the LLM wants to call a tool
    if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls;
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);

        // e. Execute the specific tool
        if (toolName === 'create_new_tool') {
            // Execute tool creation using the ToolManager's method
            const creationResult = await toolManager.executeToolCreation(
                toolArgs.task_description,
                toolArgs.suggested_name
            );
            // Handle success/failure of creation...
            return creationResult.error ? `Error: ${creationResult.error}` : `Tool '${creationResult.name}' created!`;
        } else {
            // Execute other tools (requires implementation)
            // const toolResult = await executeMyOtherTool(toolName, toolArgs);
            // Potentially call LLM again with the tool result...
            return `Placeholder: Executed ${toolName}`;
        }
    } else {
        // Return the LLM's direct response
        return message.content;
    }
}

// Example Usage:
// handleUserInput("Create a tool that translates text from English to French.").then(console.log);
// handleUserInput("What is the weather like?").then(console.log); // Assuming 'get_weather' tool exists
```

## Future Use Case Example: LLM MMORPG
(This section outlines a potential future application, not implemented in the current library version)
Imagine an MMORPG where the entire game engine runs on the backend, and the frontend only handles input and rendering. An LLM agent acts as the core logic controller.
World Creation: The agent starts with only the create_new_tool. A Game Master (GM) or player prompts: "Generate a large, persistent fantasy world map with diverse biomes."
The agent recognizes the need for a tool. It uses create_new_tool.
The LLM generates the definition for a create_world(name, description, size, biome_list) tool.
ToolManager adds this tool to ChromaDB.
The agent then uses the newly created create_world tool to generate the game world data.


Artifacts as Tools: A player wants a unique item: "Forge me a 'Helm of Wisdom' that increases intelligence."
Agent uses create_new_tool -> LLM generates create_artifact(name, description, stats, location) tool -> Added to RAG.
Agent uses create_artifact to place the Helm in the world. The artifact itself might represent the ability to use a related tool (e.g., an analyze_lore(target) tool associated with the Helm). Artifacts become tangible representations of tool access/usage rights.


World Interaction:
"Where is the Helm of Wisdom?" -> create_new_tool -> find_artifact(name) -> Add tool -> Use tool.
"Move the Helm to the highest mountain." -> create_new_tool -> move_artifact(name, new_location) -> Add tool -> Use tool.


Low-Latency Input (Gamepad): A player uses a gamepad joystick to move.
Frontend sends high-frequency "move intent" data.
Agent initially uses create_new_tool -> LLM generates move_player(player_id, direction, speed) tool -> Added to RAG.
Crucially, the LLM/Agent also creates a player-specific "Movement Artifact" on the map, linked to the move_player tool.
The backend game loop directly checks for joystick input associated with this artifact and calls the move_player tool without involving the main LLM reasoning loop for every small movement, enabling responsive control. The LLM is only involved in creating the tool and the artifact linkage initially.


Future: Brain-Computer Interface (BCI) & Blockchain:
Replace gamepad/keyboard with EEG or other BCI. Player thinks "cast fireball."
BCI sends complex data patterns.
Agent uses create_new_tool, possibly prompting the LLM with relevant scientific papers (found using another generated tool like find_research_papers(query)).
LLM generates highly specialized tools like interpret_bci_intent(bci_data, context) and execute_combat_ability(player_id, ability_name, target).
These tools, and the "artifacts" linking BCI patterns to game actions, represent a deep, personalized connection between the player's "vibe" (neural signals) and the AI.
Due to their complexity and unique origin, these BCI-generated tool/artifact pairs could be registered on a blockchain, potentially having value or utility even outside the game as novel BCI-AI interfaces. Players using standard inputs might be seen as less "attuned" to the world's deep magic (the LLM's creative potential).


## Future Development
Implement execution logic for LLM-generated tools.
Support for more LLM APIs (Gemini, Claude).
Python version with identical structure.
More robust error handling and validation.
Advanced RAG strategies (e.g., re-ranking, metadata filtering).
Integration with workflow/orchestration engines.
Explore the MMORPG/BCI/Blockchain concepts further.

