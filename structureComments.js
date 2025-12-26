const fs = require('fs');

/**
 * Recursively processing comments and their replies.
 * @param {Array} commentsArray - Array of comment nodes from Facebook's Graph structures.
 * @returns {Array} - Cleaned up array of comment objects with nested replies.
 */
function processComments(commentsArray) {
    if (!commentsArray || !Array.isArray(commentsArray)) {
        return [];
    }

    return commentsArray.map(node => {
        const commentData = {
            id: node.id,
            author: node.author ? node.author.name : 'Unknown',
            text: node.body ? node.body.text : (node.message && node.message.text ? node.message.text : ''),
            replies: []
        };

        // Check for replies in likely locations
        // 1. node.feedback.replies.nodes (Standard Graph)
        // 2. node.replies.nodes (Simplified)
        // 3. node.feedback.replies_connection.edges[].node (New schema seen in commentObject.json)

        let foundReplies = [];

        if (node.feedback && node.feedback.replies && node.feedback.replies.nodes) {
            foundReplies = node.feedback.replies.nodes;
        } else if (node.replies && node.replies.nodes) {
            foundReplies = node.replies.nodes;
        } else if (node.feedback && node.feedback.replies_connection && node.feedback.replies_connection.edges) {
            // Map edges to nodes
            foundReplies = node.feedback.replies_connection.edges.map(edge => edge.node);
        }

        if (foundReplies && foundReplies.length > 0) {
            commentData.replies = processComments(foundReplies);
        }

        return commentData;
    });
}

/**
 * Recursively searches for an array of potential comment nodes within a large object.
 * Heuristic: Looks for an array where items have 'id' and ('body' or 'author' or 'message').
 * @param {Object|Array} obj - The object to search.
 * @returns {Array} - The first valid array of comment-like nodes found.
 */
function findCommentsArray(obj) {
    if (!obj || typeof obj !== 'object') return null;

    // Check if "this" object is the array we want
    if (Array.isArray(obj)) {
        // Heuristic: check first few elements to see if they look like comments
        if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
            const sample = obj[0];
            const hasId = 'id' in sample;
            const hasBodyOrAuthor = ('body' in sample) || ('author' in sample) || ('message' in sample);
            // Also exclude the main "post" parts which can have ID and message but are not comments.
            // A comment usually does NOT have 'comet_sections'
            const isPost = 'comet_sections' in sample;

            if (hasId && hasBodyOrAuthor && !isPost) {
                return obj;
            }
        }
        // If it's an array but doesn't look like comments, recursively search its items
        for (const item of obj) {
            const found = findCommentsArray(item);
            if (found) return found;
        }
        return null;
    }

    // If it's an object, search all keys
    // Heuristic: prioritize keys named 'comments', 'nodes', 'feedback'
    const priorityKeys = ['nodes', 'comments', 'feedback'];

    // Check priority keys first
    for (const key of priorityKeys) {
        if (key in obj) {
            const found = findCommentsArray(obj[key]);
            if (found) return found;
        }
    }

    // Check all other keys
    for (const key in obj) {
        if (!priorityKeys.includes(key)) {
            const found = findCommentsArray(obj[key]);
            if (found) return found;
        }
    }

    return null;
}

function main() {
    // 1. Target the requested file
    const inputFile = 'commentObject.json';
    const outputPath = 'structured_comments.json';

    try {
        if (!fs.existsSync(inputFile)) {
            console.error(`Error: File '${inputFile}' not found.`);
            return;
        }

        const rawData = fs.readFileSync(inputFile, 'utf8');
        const jsonContent = JSON.parse(rawData);

        console.log("Searching for comments in the file...");

        // 2. Locate the comments array using deep search
        let topLevelNodes = findCommentsArray(jsonContent);

        if (!topLevelNodes) {
            console.log("No obvious comment nodes found in the structure. Checking 'aggregated_stories'...");
            // logic fallback? 
        }

        if (topLevelNodes) {
            // 3. Process
            const structuredComments = processComments(topLevelNodes);

            // 4. Deduplicate: Remove top-level items that appear as replies in other items
            // Strategy: Collect all IDs that are children of someone else.
            const childIds = new Set();

            function collectChildIds(nodes) {
                nodes.forEach(node => {
                    if (node.replies && node.replies.length > 0) {
                        node.replies.forEach(reply => {
                            childIds.add(reply.id);
                            collectChildIds([reply]); // Recurse
                        });
                    }
                });
            }

            collectChildIds(structuredComments);

            const finalComments = structuredComments.filter(comment => !childIds.has(comment.id));

            // 5. Output
            fs.writeFileSync(outputPath, JSON.stringify(finalComments, null, 2));
            console.log(`Original top-level items: ${structuredComments.length}`);
            console.log(`Final unique top-level threads: ${finalComments.length}`);
            console.log(`Output saved to: ${outputPath}`);
        } else {
            console.warn("Could not find any array looking like comments (nodes with id, author/body).");
            console.log("Writing empty array to output.");
            fs.writeFileSync(outputPath, "[]");
        }

    } catch (error) {
        console.error("Error processing file:", error);
    }
}

main();
