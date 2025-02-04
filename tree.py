from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import openai
from typing import Optional, List
import uuid

# Data models
class Node:
    def __init__(self, content: str, parent_id: Optional[str] = None, is_user: bool = False):
        self.id = str(uuid.uuid4())
        self.content = content
        self.parent_id = parent_id
        self.children: List[str] = []
        self.is_user = is_user

class ChatTree:
    def __init__(self):
        self.nodes = {}
        self.root_id = None

    def add_node(self, content: str, parent_id: Optional[str] = None, is_user: bool = False) -> str:
        node = Node(content, parent_id, is_user)
        if not self.root_id:
            self.root_id = node.id
        elif parent_id in self.nodes:
            self.nodes[parent_id].children.append(node.id)
        self.nodes[node.id] = node
        return node.id

class ChatRequest(BaseModel):
    prompt: str
    parent_id: Optional[str] = None
    is_user: bool = False

# Initialize FastAPI and chat tree
app = FastAPI()
chat_tree = ChatTree()

# Initialize with welcome message
def init_chat_tree():
    chat_tree.nodes = {}  # Clear existing nodes
    chat_tree.root_id = None
    # Only add the welcome message if there are no nodes
    if not chat_tree.nodes:
        chat_tree.add_node("Hello! How can I assist you today?", is_user=False)

# Initialize on startup
@app.on_event("startup")
async def startup_event():
    init_chat_tree()

# Set up templates and static files
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/chat")
async def chat(chat_request: ChatRequest, request: Request):
    # Get API key from headers
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        raise HTTPException(status_code=400, detail="OpenAI API key is required")

    if chat_request.is_user:
        # Directly add user message to tree
        node_id = chat_tree.add_node(
            content=chat_request.prompt,
            parent_id=chat_request.parent_id,
            is_user=True
        )
        return {
            "id": node_id,
            "content": chat_request.prompt,
            "parent_id": chat_request.parent_id,
            "is_user": True
        }
    else:
        # Build conversation history
        messages = []
        current_id = chat_request.parent_id
        while current_id and current_id in chat_tree.nodes:
            node = chat_tree.nodes[current_id]
            role = "user" if node.is_user else "assistant"
            messages.insert(0, {"role": role, "content": node.content})
            current_id = node.parent_id
            
        messages.append({"role": "user", "content": chat_request.prompt})
        
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=messages,
            n=3,
            temperature=0.7
        )
        
        # Track unique responses
        unique_responses = {}
        for choice in response.choices:
            content = choice.message.content
            if content not in unique_responses:
                node_id = chat_tree.add_node(
                    content=content,
                    parent_id=chat_request.parent_id,
                    is_user=False
                )
                unique_responses[content] = {
                    "id": node_id,
                    "content": content,
                    "parent_id": chat_request.parent_id,
                    "is_user": False
                }
        
        return list(unique_responses.values())

@app.get("/tree")
async def get_tree():
    return {"nodes": chat_tree.nodes}

@app.post("/reset")
async def reset_tree():
    init_chat_tree()
    return {"status": "success"}
