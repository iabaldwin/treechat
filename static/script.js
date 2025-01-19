let currentParentId = null;
let treeData = null;

// Set up the D3 tree visualization
const margin = {top: 20, right: 20, bottom: 20, left: 20};

// Get the container's dimensions
const container = document.getElementById("tree-container");
const width = container.clientWidth - margin.left - margin.right;
const height = container.clientHeight - margin.top - margin.bottom;

// Configure the tree layout
const tree = d3.tree()
    .nodeSize([60, width/4])  // [vertical spacing, horizontal spacing]
    .separation(function(a, b) {
        return a.parent === b.parent ? 1.2 : 2;
    });

const svg = d3.select("#tree-container").append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .append("g")
    .attr("transform", `translate(${width/2},${margin.top})`);

// Log the dimensions for debugging
console.log('Container dimensions:', {
    width: container.clientWidth,
    height: container.clientHeight
});
console.log('Computed dimensions:', {
    width: width,
    height: height
});

function processTreeData(nodes, rootId) {
    const root = nodes[rootId];
    if (!root) return null;

    function buildHierarchy(nodeId) {
        const node = nodes[nodeId];
        if (!node) return null;

        // Find all AI response children
        const childrenIds = Object.values(nodes)
            .filter(n => {
                if (n.parent_id === nodeId && n.is_user) {
                    return Object.values(nodes).some(ai => ai.parent_id === n.id && !ai.is_user);
                }
                return false;
            })
            .map(n => {
                // Find the AI response that follows this user message
                return Object.values(nodes).find(ai => ai.parent_id === n.id && !ai.is_user)?.id;
            })
            .filter(id => id != null);

        // Find the user message that led to this node (if it's an AI node)
        const userMessage = !node.is_user ? 
            Object.values(nodes).find(n => n.id === node.parent_id && n.is_user)?.content : 
            null;

        return {
            id: node.id,
            name: node.content.substring(0, 30) + "...",
            children: childrenIds.map(childId => buildHierarchy(childId))
                               .filter(child => child !== null),
            userMessage: userMessage  // Store the user message that led to this node
        };
    }

    return buildHierarchy(rootId);
}

function updateVisualization(data) {
    svg.selectAll("*").remove();
    
    const root = d3.hierarchy(data);
    const treeLayout = tree(root);

    // Add links with user messages as labels
    const links = svg.selectAll(".link")
        .data(treeLayout.links())
        .enter()
        .append("g");

    links.append("path")
        .attr("class", "link")
        .attr("d", d3.linkVertical()
            .x(d => d.x)
            .y(d => d.y));

    // Add user messages as edge labels
    links.append("text")
        .attr("class", "edge-label")
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2)
        .attr("text-anchor", "middle")
        .attr("dy", -5)
        .text(d => d.target.data.userMessage ? d.target.data.userMessage.substring(0, 20) + "..." : "");

    // Add nodes (AI responses only)
    const nodes = svg.selectAll(".node")
        .data(treeLayout.descendants())
        .enter().append("g")
        .attr("class", d => `node ${d.data.id === currentParentId ? 'selected' : ''}`)
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .on("click", function(event, d) {
            currentParentId = d.data.id;
            updateVisualization(data);
            updateMessages();
        });

    nodes.append("circle")
        .attr("r", 10);

    nodes.append("text")
        .attr("dy", "2em")
        .attr("y", d => d.children ? -20 : 20)
        .attr("text-anchor", "middle")
        .text(d => d.data.name);
}

function updateMessages() {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    
    if (!treeData || !currentParentId) {
        // If no current node selected, show the root node
        const rootNode = Object.values(treeData || {}).find(node => !node.parent_id);
        if (rootNode) {
            const messageElement = document.createElement('div');
            messageElement.className = `message assistant`;
            messageElement.textContent = rootNode.content;
            messageElement.onclick = () => {
                currentParentId = rootNode.id;
                updateTree();
                updateMessages();
            };
            messagesDiv.appendChild(messageElement);
        }
        return;
    }

    // Build path from current node to root
    const messagePath = [];
    let currentNode = treeData[currentParentId];
    
    // Walk up the tree from current node to root
    while (currentNode) {
        messagePath.unshift(currentNode);  // Add to front of array
        // Get the parent node
        currentNode = currentNode.parent_id ? treeData[currentNode.parent_id] : null;
    }
    
    // Render only the messages in the path
    messagePath.forEach((message) => {
        const messageElement = document.createElement('div');
        messageElement.className = `message 
            ${message.id === currentParentId ? 'selected' : ''} 
            ${message.is_user ? 'user' : 'assistant'}`.trim();
        
        messageElement.textContent = message.content;
        
        messageElement.onclick = () => {
            currentParentId = message.id;
            updateTree();
            updateMessages();
        };
        
        messagesDiv.appendChild(messageElement);
    });
    
    // Scroll to bottom
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function updateTree() {
    const response = await fetch('/tree');
    const data = await response.json();
    treeData = data.nodes;
    
    console.log('Tree data received:', data);
    console.log('Detailed nodes structure:', JSON.stringify(data.nodes, null, 2));
    
    if (data.nodes && Object.keys(data.nodes).length > 0) {
        const entries = Object.entries(data.nodes);
        const rootId = entries[0][0];
        const hierarchicalData = processTreeData(data.nodes, rootId);
        
        console.log('Hierarchical data:', hierarchicalData);
        
        updateVisualization(hierarchicalData);
        updateMessages();
    }
}

async function sendPrompt() {
    const promptInput = document.getElementById('prompt-input');
    const apiKey = document.getElementById('api-key-input').value;
    const prompt = promptInput.value;
    
    if (!prompt) return;
    if (!apiKey) {
        alert('Please enter your OpenAI API key');
        return;
    }
    
    // Add user's message to the tree first
    const userResponse = await fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({
            prompt: prompt,
            parent_id: currentParentId || Object.keys(treeData)[0],
            is_user: true
        })
    });
    
    const userData = await userResponse.json();
    currentParentId = userData.id;  // Set the user message as parent for AI response
    
    // Get AI's response
    const aiResponse = await fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
        },
        body: JSON.stringify({
            prompt: prompt,
            parent_id: currentParentId,
            is_user: false
        })
    });
    
    const aiData = await aiResponse.json();
    if (aiData.id) {
        currentParentId = aiData.id;
    }
    
    updateTree();
    promptInput.value = '';
}

// Add event listeners
document.getElementById('prompt-input').addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendPrompt();
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey) {
        event.preventDefault();
        
        console.log('Arrow key pressed:', event.key);
        console.log('Current parent ID:', currentParentId);
        console.log('Full tree data:', treeData);
        
        const currentNode = treeData[currentParentId];
        if (!currentNode) {
            console.log('No current node found!');
            return;
        }
        
        console.log('Current node:', {
            id: currentNode.id,
            content: currentNode.content.substring(0, 30),
            parent_id: currentNode.parent_id,
            is_user: currentNode.is_user
        });
        
        if (event.key === 'ArrowUp') {
            console.log('Looking for previous AI node from:', currentNode.id);
            
            // Keep going up until we find an AI message or hit the root
            let searchNode = currentNode;
            while (searchNode.parent_id) {
                const parentNode = treeData[searchNode.parent_id];
                console.log('Checking node:', {
                    id: parentNode.id,
                    content: parentNode.content.substring(0, 30),
                    is_user: parentNode.is_user
                });
                
                if (!parentNode.is_user) {
                    console.log('Found previous AI node');
                    currentParentId = parentNode.id;
                    updateTree();
                    updateMessages();
                    break;
                }
                searchNode = parentNode;
            }
        } else {
            console.log('Looking for next AI node from:', currentNode.id);
            
            // First find the user message that follows this AI message
            const userChild = Object.values(treeData)
                .find(node => node.parent_id === currentNode.id && node.is_user);
            console.log('Found user child:', userChild ? {
                id: userChild.id,
                content: userChild.content.substring(0, 30),
                is_user: userChild.is_user
            } : 'none');
            
            if (userChild) {
                // Then find the AI message that follows that user message
                const aiChild = Object.values(treeData)
                    .find(node => node.parent_id === userChild.id && !node.is_user);
                console.log('Found AI child:', aiChild ? {
                    id: aiChild.id,
                    content: aiChild.content.substring(0, 30),
                    is_user: aiChild.is_user
                } : 'none');
                
                if (aiChild) {
                    console.log('Moving down to next AI node');
                    currentParentId = aiChild.id;
                    updateTree();
                    updateMessages();
                } else {
                    console.log('No AI response after user message');
                }
            } else {
                console.log('No user message follows this AI message');
            }
        }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        
        console.log('Arrow key pressed:', event.key);
        
        const currentNode = treeData[currentParentId];
        if (!currentNode || !currentNode.parent_id) return;
        
        // Get all AI siblings (including current node)
        const parentNode = treeData[currentNode.parent_id];
        if (!parentNode) return;

        // First find the user message that led to this AI message
        const userParent = Object.values(treeData)
            .find(n => n.children && n.children.includes(currentNode.id) && n.is_user);
        
        if (!userParent) return;
        
        // Then find the AI parent of that user message
        const aiParent = Object.values(treeData)
            .find(n => n.children && n.children.includes(userParent.id) && !n.is_user);
        
        if (!aiParent) return;
        
        // Get all user messages that are children of this AI parent
        const userSiblings = Object.values(treeData)
            .filter(n => n.parent_id === aiParent.id && n.is_user);
        
        // Get the AI responses for each user message
        const aiSiblings = userSiblings
            .map(user => Object.values(treeData)
                .find(n => n.parent_id === user.id && !n.is_user))
            .filter(n => n !== null);
        
        // Find current position in siblings
        const currentIndex = aiSiblings.findIndex(n => n.id === currentParentId);
        
        if (event.key === 'ArrowLeft' && currentIndex > 0) {
            currentParentId = aiSiblings[currentIndex - 1].id;
            updateTree();
            updateMessages();
        } else if (event.key === 'ArrowRight' && currentIndex < aiSiblings.length - 1) {
            currentParentId = aiSiblings[currentIndex + 1].id;
            updateTree();
            updateMessages();
        }
    }
});

async function resetTree() {
    try {
        const apiKey = document.getElementById('api-key-input').value;
        await fetch('/reset', { 
            method: 'POST',
            headers: {
                'X-API-Key': apiKey
            }
        });
        currentParentId = null;
        treeData = null;
        updateTree();
    } catch (error) {
        console.error('Error resetting tree:', error);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    resetTree();
});

// Initial tree load
resetTree();
