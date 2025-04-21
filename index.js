import OpenAI from 'openai';
import { ToolManager } from './toolManager.js';
import readline from 'readline'; // For interactive demo

// --- LLM Client Setup ---
// Configure for OpenAI, Ollama, vLLM, etc.
// Ensure you have OPENAI_API_KEY in env for OpenAI, or adjust baseURL/apiKey for others.
// For Ollama, baseURL is typically http://localhost:11434/v1 and apiKey is often 'ollama' or not required.
const openai = new OpenAI({
    baseURL: process.env.OPENAI_API_BASE || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1', // Default to Ollama-like URL
    apiKey: process.env.OPENAI_API_KEY || 'ollama', // Default to 'ollama' if no key
});
// Specify the model you are using (e.g., 'gpt-4o', 'llama3', 'mistral')
openai.model = process.env.MODEL_NAME || 'qwen2.5-coder:7b-instruct-q8_0'; // Set a default model
console.log(`Using LLM model: ${openai.model} via ${openai.baseURL}`);


// --- Agent Setup ---
const toolManager = new ToolManager(openai); // Pass LLM client for tool creation

// --- Simple Agent Logic Example ---
class Agent {
    constructor(llmClient, toolMgr) {
        this.llmClient = llmClient;
        this.toolManager = toolMgr;
    }

    async process(userInput) {
        console.log(`\n[Agent] Processing: "${userInput}"`);

        // 1. Get contextually relevant tools (including core tool creator)
        const availableTools = await this.toolManager.getAvailableTools(userInput, 5);
        console.log(`[Agent] Available tools: ${availableTools.map(t => t.name).join(', ')}`);

        // Map to OpenAI tool format
        const toolsForLLM = availableTools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));

        // 2. Call LLM with user input and available tools
        try {
            const response = await this.llmClient.chat.completions.create({
                model: this.llmClient.model,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant. Use the available tools when necessary.' },
                    { role: 'user', content: userInput }
                ],
                tools: toolsForLLM.length > 0 ? toolsForLLM : undefined,
                tool_choice: toolsForLLM.length > 0 ? 'auto' : undefined,
            });

            const message = response.choices[0].message;

            // 3. Handle LLM response: Direct answer or Tool Call
            if (message.tool_calls && message.tool_calls.length > 0) {
                const toolCall = message.tool_calls[0]; // Handle one tool call for simplicity
                const toolName = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments);

                console.log(`[Agent] LLM requested tool: ${toolName} with args:`, toolArgs);

                // 4. Execute the called tool
                if (toolName === TOOL_CREATION_TOOL_DEF.name) {
                    // Execute the special tool creation tool
                    const result = await this.toolManager.executeToolCreation(
                        toolArgs.task_description,
                        toolArgs.suggested_name
                    );
                    if (result.error) {
                        console.error(`[Agent] Failed to create tool: ${result.error}`);
                        return `Sorry, I encountered an error trying to create that tool: ${result.error}`;
                    } else {
                        console.log(`[Agent] Successfully created tool: ${result.name}`);
                        return `I have successfully created the tool: '${result.name}'. You can now use it if relevant.`;
                    }
                } else {
                    // --- Placeholder for executing OTHER tools ---
                    // In a real system, you would look up the tool definition
                    // and execute its associated code/logic here.
                    // For this example, we just acknowledge the request.
                    console.log(`[Agent] Placeholder: Would execute tool '${toolName}' here.`);
                    // You might need to call the LLM *again* with the tool's result.
                    return `I received a request to use the tool '${toolName}', but executing generated tools is not implemented in this example.`;
                }

            } else {
                // No tool call, just return the LLM's text response
                console.log("[Agent] LLM provided direct answer.");
                return message.content;
            }

        } catch (error) {
            console.error("[Agent] Error during LLM interaction:", error);
            return "Sorry, I encountered an error processing your request.";
        }
    }
}

// --- Interactive Demo ---
async function runDemo() {
    // Initialize ChromaDB connection and ensure core tool exists
    try {
         await toolManager._getOrCreateCollection(); // Explicitly initialize
         console.log("Tool Manager initialized and core tool checked/added.");
    } catch (error) {
        console.error("Failed to initialize Tool Manager. Exiting.", error);
        return;
    }


    const agent = new Agent(openai, toolManager);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'You: '
    });

    console.log("\nSimple Agent Demo. Type 'exit' to quit.");
    console.log("Try asking the agent to create a tool, e.g.:");
    console.log(" 'create a tool to calculate the area of a rectangle given length and width'");
    console.log(" 'make a function to greet a user by name'");
    console.log("--------------------------------------------------");

    rl.prompt();

    rl.on('line', async (line) => {
        const userInput = line.trim();
        if (userInput.toLowerCase() === 'exit') {
            rl.close();
            return;
        }
        if (!userInput) {
            rl.prompt();
            return;
        }

        const response = await agent.process(userInput);
        console.log("Agent:", response);
        rl.prompt();
    }).on('close', () => {
        console.log('Exiting demo.');
        process.exit(0);
    });
}

// --- Run the demo ---
runDemo();

