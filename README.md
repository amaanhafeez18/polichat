 [Retrieval Augmented Generation (RAG)](https://en.wikipedia.org/wiki/Prompt_engineering#Retrieval-augmented_generation) to easily inject contextual relevant information into the prompt sent to the model. This results in better and more accurate replies from the bot.

The sample uses a local Vector Database, called Pinecone to find the most relevant information to include in the prompt for the users input. you!



1. Add your OpenAI key to the `SECRET_OPENAI_KEY` variable in the `./env/.env.local.user` file.
2. Add your Pinecone key to the `PINECONE_API_KEY` variable in the `./env/.env.local.user` file.
2. Add your Pinecone index name  to the `PINECONE_INDEX_NAME` variable in the `./env/.env.local.user` file.






### Using Teams Toolkit for Visual Studio Code

The simplest way to run this sample in Teams is to use Teams Toolkit for Visual Studio Code.

1. Ensure you have downloaded and installed [Visual Studio Code](https://code.visualstudio.com/docs/setup/setup-overview)
1. Install the [Teams Toolkit extension](https://marketplace.visualstudio.com/items?itemName=TeamsDevApp.ms-teams-vscode-extension)
1. Copy this sample into a new folder outside of teams-ai
1. Select File > Open Folder in VS Code and choose this sample's directory
1. Using the extension, sign in with your Microsoft 365 account where you have permissions to upload custom apps
1. Ensure that you have set up the sample from the previous step.
1. Select **Debug > Start Debugging** or **F5** to run the app in a Teams web client.
1. In the browser that launches, select the **Add** button to install the app to Teams.
