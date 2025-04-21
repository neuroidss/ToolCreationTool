import { ChromaClient, OpenAIEmbeddingFunction } from 'chromadb';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai'; // Used here for the creation logic

// --- Configuration ---
// ChromaDB setup (run ChromaDB instance, e.g., via Docker: docker run -p 8000:8000 chromadb/chroma)
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const COLLECTION_NAME = "agent_tools";
// Use OpenAI Embedding Function (requires OPENAI_API_KEY)
// Or replace with a different embedding function if needed (e.g., Ollama's)
// NOTE: For local models (Ollama), you might need a different embedding strategy
// if you don't want to rely on OpenAI's embedding API. This example uses OpenAI's.
// Ensure OPENAI_API_KEY is set in your environment variables.
// If using Ollama/vLLM for *embeddings* as well, you'd need a custom embedding function.
const embedder = process.env.OPENAI_API_KEY
    ? new OpenAIEmbeddingFunction({ openai_api_key: process.env.OPENAI_API_KEY })
    : null; // Add fallback or error handling if needed


// --- Core Tool Definition: ToolCreationTool ---
const TOOL_CREATION_TOOL_ID = 'core_create_tool_001';
const TOOL_CREATION_TOOL_DEF = {
    id: TOOL_CREATION_TOOL_ID,
    name: 'create_new_tool',
    description: 'Creates a definition for a new tool based on a natural language description of the desired functionality. It generates the tool name, description, and JSON parameter schema.',
    parameters: {
        type: 'object',
        properties: {
            task_description: {
                type: 'string',
                description: 'A detailed natural language description of what the new tool should do, its purpose, and any specific inputs it should take.',
            },
            suggested_name: {
                 type: 'string',
                 description: 'Optional: A suggested base name for the tool (e.g., "get_weather"). The LLM might refine it.'
            }
        },
        required: ['task_description'],
    },
    type: 'core', // Mark as a core, non-removable tool
};

// --- Tool Manager Class ---
export class ToolManager {
    constructor(llmClient) {
        if (!embedder) {
            console.warn("Warning: OpenAI API Key not found. Embeddings and ChromaDB operations requiring embeddings will fail. Set OPENAI_API_KEY environment variable.");
            // Depending on requirements, you might throw an error or use a dummy embedder
        }
        this.chromaClient = new ChromaClient({ path: CHROMA_URL });
        this.collection = null;
        this.llmClient = llmClient; // LLM client for executing tool creation
    }

    async _getOrCreateCollection() {
        if (!this.collection) {
            if (!embedder) {
                throw new Error("Cannot create collection without an embedding function. Ensure OPENAI_API_KEY is set.");
            }
            try {
                this.collection = await this.chromaClient.getOrCreateCollection({
                    name: COLLECTION_NAME,
                    embeddingFunction: embedder,
                    metadata: { "hnsw:space": "cosine" } // Use cosine distance
                });
                console.log(`Connected to ChromaDB collection: ${COLLECTION_NAME}`);
            } catch (error) {
                console.error("Error connecting to ChromaDB:", error);
                throw new Error("Could not connect to or create ChromaDB collection.");
            }
        }
         // Ensure the core tool creation tool definition exists
         await this.ensureToolCreationTool();
        return this.collection;
    }

    // Ensure the core ToolCreationTool is always present
    async ensureToolCreationTool() {
        const collection = await this._getOrCreateCollection();
        try {
            const existing = await collection.get({ ids: [TOOL_CREATION_TOOL_ID] });
            if (existing.ids.length === 0) {
                console.log(`Core tool '${TOOL_CREATION_TOOL_DEF.name}' not found. Adding it.`);
                await this.addTool(TOOL_CREATION_TOOL_DEF, true); // Add without generating embedding text if it's core
            }
        } catch (error) {
             // Handle cases where the collection might be empty or other get errors
             if (error.message?.includes("not found")) { // Simple check
                 console.log(`Core tool '${TOOL_CREATION_TOOL_DEF.name}' not found (initial add). Adding it.`);
                 await this.addTool(TOOL_CREATION_TOOL_DEF, true);
             } else {
                console.error("Error checking/adding core tool:", error);
             }
        }
    }

    // Add or update a tool definition in ChromaDB
    async addTool(toolDefinition, isCore = false) {
        if (!toolDefinition.id) {
            toolDefinition.id = uuidv4(); // Assign unique ID if missing
        }
        if (!toolDefinition.type) {
             toolDefinition.type = isCore ? 'core' : 'llm_generated';
        }

        const collection = await this._getOrCreateCollection();

        // Use description for embedding, but store the full definition in metadata
        // For the core tool, we might not need to embed its description if retrieval isn't the goal,
        // but it's simpler to embed it anyway.
        const embeddingText = `${toolDefinition.name}: ${toolDefinition.description}`;

        try {
            await collection.upsert({
                ids: [toolDefinition.id],
                metadatas: [{ ...toolDefinition }], // Store full definition
                documents: [embeddingText], // Text used for embedding/search
            });
            console.log(`Tool '${toolDefinition.name}' (ID: ${toolDefinition.id}) added/updated in RAG.`);
            return toolDefinition;
        } catch (error) {
            console.error(`Error adding/updating tool '${toolDefinition.name}' to ChromaDB:`, error);
            throw error; // Re-throw for caller handling
        }
    }

    // Retrieve a specific tool by ID
    async getTool(id) {
        const collection = await this._getOrCreateCollection();
        try {
            const results = await collection.get({ ids: [id], include: ["metadatas"] });
            if (results.ids.length > 0) {
                return results.metadatas[0];
            }
            return null;
        } catch (error) {
            console.error(`Error retrieving tool ID '${id}':`, error);
            return null;
        }
    }

    // Get tools relevant to a context, always including ToolCreationTool first
    async getAvailableTools(context, maxResults = 5) {
        const collection = await this._getOrCreateCollection(); // Also ensures core tool exists

        let relevantTools = [];
        if (context && embedder) { // Only query if context and embedder are available
            try {
                const results = await collection.query({
                    queryTexts: [context],
                    nResults: Math.max(1, maxResults), // Ensure at least 1 result requested
                    include: ["metadatas"],
                    // Optional: Filter out the core tool if needed, then add it back
                    // where: { type: { "$ne": "core" } }
                });

                if (results && results.metadatas && results.metadatas.length > 0) {
                    relevantTools = results.metadatas[0] // Access the inner array for the first query text
                                    .map(meta => meta) // Assuming metadata is the tool definition
                                    .filter(tool => tool.id !== TOOL_CREATION_TOOL_ID); // Filter out core tool if already present
                }
            } catch (error) {
                console.error("Error querying ChromaDB for relevant tools:", error);
                // Proceed without context-based tools if query fails
            }
        } else if (!embedder) {
            console.warn("Context provided, but no embedder configured. Skipping similarity search.");
        }


        // Fetch the core tool definition explicitly to ensure it's the correct, latest version
        const coreTool = await this.getTool(TOOL_CREATION_TOOL_ID);
        if (!coreTool) {
             // This shouldn't happen if ensureToolCreationTool worked, but handle defensively
             console.error("Critical Error: Core Tool Creation Tool definition is missing!");
             // Optionally re-add it here
             // await this.addTool(TOOL_CREATION_TOOL_DEF, true);
             // return relevantTools; // Return only relevant ones found
             return [TOOL_CREATION_TOOL_DEF, ...relevantTools]; // Use the constant as fallback
        }


        // Combine, ensuring core tool is first and unique
        const finalTools = [coreTool, ...relevantTools];
        const uniqueToolIds = new Set();
        const uniqueTools = finalTools.filter(tool => {
            if (!uniqueToolIds.has(tool.id)) {
                uniqueToolIds.add(tool.id);
                return true;
            }
            return false;
        });

        // Ensure the list doesn't exceed maxResults (after adding the core tool)
        return uniqueTools.slice(0, maxResults + 1); // +1 because core tool is always added
    }

    // --- Execute the Tool Creation Tool ---
    // This function is called when the LLM decides to use 'create_new_tool'
    async executeToolCreation(taskDescription, suggestedName = null) {
        if (!this.llmClient) {
            throw new Error("LLMClient is required for tool creation execution.");
        }

        console.log(`Executing Tool Creation for task: "${taskDescription}"`);

        const prompt = `
            You are an expert tool designer. Based on the following task description, create a JSON definition for a new tool.
            The JSON definition must include:
            1.  'name': A concise, descriptive, snake_case name for the tool. ${suggestedName ? `Consider the suggestion: "${suggestedName}".`: ''}
            2.  'description': A clear, detailed explanation of what the tool does.
            3.  'parameters': A JSON schema object defining the necessary inputs for the tool. Define 'type', 'properties', and 'required' fields accurately. If no parameters are needed, provide an empty properties object: { "type": "object", "properties": {} }.

            Task Description: "${taskDescription}"

            Output *only* the JSON object for the tool definition, enclosed in triple backticks (\`\`\`). Do not include any other text before or after the JSON block.

            Example Input task_description: "Get the current weather for a given city."
            Example Output:
            \`\`\`json
            {
              "name": "get_current_weather",
              "description": "Retrieves the current weather conditions for a specified city.",
              "parameters": {
                "type": "object",
                "properties": {
                  "city": {
                    "type": "string",
                    "description": "The name of the city for which to get the weather."
                  }
                },
                "required": ["city"]
              }
            }
            \`\`\`

            Now, generate the JSON for the requested task.
        `;

        try {
            const response = await this.llmClient.chat.completions.create({
                model: this.llmClient.model, // Use the model configured in the client
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2, // Lower temperature for more predictable JSON structure
            });

            const rawResponse = response.choices[0]?.message?.content?.trim();
            if (!rawResponse) {
                throw new Error("LLM response was empty.");
            }

            // Extract JSON from the response (robust extraction)
            const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
            let toolJson;
            if (jsonMatch && jsonMatch[1]) {
                 toolJson = jsonMatch[1];
            } else if (rawResponse.startsWith('{') && rawResponse.endsWith('}')) {
                 // Fallback if backticks are missing but it looks like JSON
                 toolJson = rawResponse;
            } else {
                throw new Error(`LLM response did not contain the expected JSON format. Response: ${rawResponse}`);
            }


            let generatedToolDef;
            try {
                generatedToolDef = JSON.parse(toolJson);
            } catch (parseError) {
                throw new Error(`Failed to parse JSON from LLM response: ${parseError.message}. Raw JSON: ${toolJson}`);
            }

            // Validate basic structure
            if (!generatedToolDef.name || !generatedToolDef.description || !generatedToolDef.parameters) {
                throw new Error(`Generated tool definition is missing required fields (name, description, parameters). Definition: ${JSON.stringify(generatedToolDef)}`);
            }
             if (typeof generatedToolDef.parameters !== 'object' || !generatedToolDef.parameters.type || !generatedToolDef.parameters.properties) {
                  throw new Error(`Generated tool parameters are not a valid JSON schema object. Definition: ${JSON.stringify(generatedToolDef)}`);
             }


            // Add the newly defined tool to RAG
            const addedTool = await this.addTool(generatedToolDef);

            console.log(`Successfully created and stored new tool: '${addedTool.name}'`);
            return addedTool; // Return the definition of the newly created tool

        } catch (error) {
            console.error("Error during tool creation execution:", error);
            // Return a failure message or throw
             return { error: `Failed to create tool: ${error.message}` };
        }
    }
}
