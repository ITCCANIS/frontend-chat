// Add at the top of the file
let socket = null;
let currentChatReceiver = null;
let currentRoomId = null;
let currentUserId = null;

function connectToSocket() {
  const apiKey = localStorage.getItem("apiKey");
  const jwt = localStorage.getItem("jwt");

  if (!apiKey || !jwt) return;

  // Initialize socket connection
  socket = io("https://chatapp-backend-api-production.up.railway.app", {
    extraHeaders: {
      "x-api-key": apiKey,
      authorization: jwt,
    },
  });

  // Connection event handlers
  socket.on("connect", () => {
    console.log("Connected to socket server");
    socket.on("online:users", (data) => {
      console.log("Online users:", data);
      updateOnlineUsersList(data);
    });
  });

  socket.on("presence:updated", (data) => {
    console.log(data);
    // Refresh online users list when someone's status changes
    socket.on("online:users", (data) => {
      updateOnlineUsersList(data);
    });
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
    showError(error.message);
  });

  // Replace the socket event handler for messages in connectToSocket function
  socket.on("message:received", (data) => {
    console.log("Received message:", data);

    if (data.type === "group" && currentRoomId === data.receiverId) {
      // Handle room messages
      addMessageToRoom(data.content, "received", data.sender.username);
    } else {
      // Handle private messages
      if (
        currentChatReceiver &&
        data.sender._id === currentChatReceiver.userId
      ) {
        addMessageToUI(data.content, "received", data.sender.username);
      } else {
        // Optionally add notification for messages when chat is not open
        console.log("New message from:", data.sender.username);
      }
    }
  });

  socket.on("message:sent", (data) => {
    console.log("Message sent successfully:", data);
  });

  // Add debug logging to socket event handler
  socket.on("room:joined", (data) => {
    console.log("Joining room:", data);
    currentRoomId = data.roomId;
    const roomElement = document.querySelector(
      `[data-room-id="${data.roomId}"]`
    );
    if (roomElement) {
      const roomName = roomElement.getAttribute("data-room-name");
      showRoomChat(roomName);
    } else {
      console.error("Room element not found for id:", data.roomId);
    }
  });

  socket.on("room:left", () => {
    hideRoomChat();
    currentRoomId = null;
  });
}

// Add this function after connectToSocket()
async function loadRooms() {
  const apiKey = localStorage.getItem("apiKey");
  const jwt = localStorage.getItem("jwt");

  if (!apiKey || !jwt) return;

  try {
    const response = await fetch(
      "https://chatapp-backend-api-production.up.railway.app/api/getRooms",
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          Authorization: jwt,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      updateRoomsList(data.rooms);
    } else {
      showError("Failed to load rooms");
    }
  } catch (error) {
    console.error("Error loading rooms:", error);
    showError("Failed to load rooms");
  }
}

function updateRoomsList(rooms) {
  const roomsList = document.getElementById("roomsList");
  roomsList.innerHTML = "<h4>Your Rooms</h4>";

  if (rooms.length === 0) {
    roomsList.innerHTML += '<p class="no-rooms">No rooms yet</p>';
    return;
  }

  rooms.forEach((room) => {
    const roomElement = document.createElement("div");
    roomElement.className = "room-item";
    roomElement.setAttribute("data-room-id", room._id);
    roomElement.setAttribute("data-room-name", room.name);
    roomElement.innerHTML = `
            <div class="room-info">
                <h5>${room.name}</h5>
                <span class="member-count">${room.members.length} members</span>
            </div>
        `;
    roomElement.addEventListener("click", () => joinRoom(room._id));
    roomsList.appendChild(roomElement);
  });
}

// Remove the duplicate updateOnlineUsersList function and keep this one
function updateOnlineUsersList(onlineUsers) {
  // Create a map of online users for quick lookup
  const onlineUsersMap = new Map(
    onlineUsers.map((user) => [user.userId || user._id, user])
  );

  // Update status for all users in the list
  const userElements = document.querySelectorAll(".user-item");
  userElements.forEach((element) => {
    const userId = element.getAttribute("data-user-id");
    const statusDot = element.querySelector(".user-status");

    if (onlineUsersMap.has(userId) && userId !== currentUserId) {
      statusDot.classList.add("status-online");
    } else {
      statusDot.classList.remove("status-online");
    }
  });
}

// Modify the openChatInterface function
async function openChatInterface(receiver) {
  currentChatReceiver = {
    ...receiver,
    userId: receiver.userId || receiver._id, // Handle both socket and DB user objects
  };
  document.getElementById("chatRecipient").textContent = receiver.username;
  document.getElementById("chatInterface").style.display = "block";

  // Clear existing messages
  const messagesContainer = document.getElementById("messagesContainer");
  messagesContainer.innerHTML =
    '<div class="loading-messages">Loading messages...</div>';

  // Load message history with sender and receiver IDs
  try {
    const messages = await loadMessageHistory({
      senderId: currentUserId,
      receiverId: receiver._id,
    });

    // Clear loading message
    messagesContainer.innerHTML = "";

    // Display messages in chronological order
    messages.reverse().forEach((message) => {
      // Check if the current user is the sender
      const isSentByMe = message.senderId._id === currentUserId;
      const type = isSentByMe ? "sent" : "received";

      // For received messages, include sender's username
      if (!isSentByMe) {
        addMessageToUI(message.content, type, message.senderId.username);
      } else {
        addMessageToUI(message.content, type);
      }
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (error) {
    console.error("Error:", error);
    showError("Failed to load message history", "chat");
  }
}

function closeChatInterface() {
  document.getElementById("chatInterface").style.display = "none";
  currentChatReceiver = null;
}

document.getElementById("messageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentChatReceiver) return;

  const messageInput = document.getElementById("messageInput");
  const content = messageInput.value.trim();

  if (!content) return;

  // Add message to UI immediately
  addMessageToUI(content, "sent");

  // Send message through socket
  socket.emit("message:private:send", {
    receiverId: currentChatReceiver.userId,
    content: content,
  });

  messageInput.value = "";
});

// Update the addMessageToUI function to handle sender names
function addMessageToUI(content, type, senderName = "") {
  const messagesContainer = document.getElementById("messagesContainer");
  const messageElement = document.createElement("div");
  messageElement.className = `message ${type}`;

  if (type === "received" && senderName) {
    messageElement.innerHTML = `<span class="sender-name">${senderName}:</span> ${content}`;
  } else {
    messageElement.textContent = content;
  }

  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function saveApiKey() {
  const apiKey = document.getElementById("apiKey").value;
  localStorage.setItem("apiKey", apiKey);
  alert("API Key saved!");
}

function toggleLoginMode(mode) {
  const normalForm = document.getElementById("loginForm");
  const firstTimeForm = document.getElementById("firstLoginForm");
  const toggleBtns = document.querySelectorAll(".toggle-btn");

  toggleBtns.forEach((btn) => btn.classList.remove("active"));
  if (mode === "normal") {
    normalForm.style.display = "block";
    firstTimeForm.style.display = "none";
    toggleBtns[0].classList.add("active");
  } else {
    normalForm.style.display = "none";
    firstTimeForm.style.display = "block";
    toggleBtns[1].classList.add("active");
  }
}

// Regular login form handler
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKey = localStorage.getItem("apiKey");
  if (!apiKey) {
    alert("Please set API Key first");
    return;
  }

  const loginData = {
    email: document.getElementById("username").value,
    password: document.getElementById("password").value,
  };

  try {
    const response = await fetch(
      "https://chatapp-backend-api-production.up.railway.app/api/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(loginData),
      }
    );

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem("jwt", data.token);
      localStorage.setItem("username", loginData.email);
      localStorage.setItem("userRole", data.user.role);
      currentUserId = data.user._id; // Add this line

      // Hide login section
      document.getElementById("loginSection").style.display = "none";

      // Update username display
      document.getElementById("homeUserDisplayName").textContent =
        loginData.email;

      // Show home page
      document.getElementById("homePage").style.display = "block";

      // Show register button for admins
      if (data.user.role === "admin") {
        document.getElementById("registerNavButton").style.display = "block";
      }

      // Show home page with dashboard
      document.getElementById("homePage").style.display = "block";

      // You might want to load existing rooms here
      await Promise.all([loadRooms(), loadAllUsers()]);

      // Connect to socket after successful login
      connectToSocket();
    } else {
      const errorDiv = document.createElement("div");
      errorDiv.className = "error-message";
      errorDiv.textContent = "Invalid credentials";
      document.getElementById("loginForm").appendChild(errorDiv);
      setTimeout(() => errorDiv.remove(), 3000);
    }
  } catch (error) {
    console.error("Error:", error);
  }
});

// First time login form handler
document
  .getElementById("firstLoginForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = localStorage.getItem("apiKey");
    if (!apiKey) {
      showError("Please set API Key first");
      return;
    }

    const password = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      showError("Passwords do not match");
      return;
    }

    const loginData = {
      email: document.getElementById("firstLoginEmail").value,
      oneTimeToken: document.getElementById("oneTimeToken").value,
      password: password,
    };

    try {
      const response = await fetch(
        "https://chatapp-backend-api-production.up.railway.app/api/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify(loginData),
        }
      );

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("jwt", data.token);
        localStorage.setItem("username", loginData.email);
        localStorage.setItem("userRole", data.user.role);
        currentUserId = data.user._id; // Add this line

        document.getElementById("loginSection").style.display = "none";

        // Update username display
        document.getElementById("homeUserDisplayName").textContent =
          loginData.email;

        // Show home page
        document.getElementById("homePage").style.display = "block";

        // Show register button for admins
        if (data.user.role === "admin") {
          document.getElementById("registerNavButton").style.display = "block";
        }

        // Show home page with dashboard
        document.getElementById("homePage").style.display = "block";

        // You might want to load existing rooms here
        await Promise.all([loadRooms(), loadAllUsers()]);

        // Connect to socket after successful login
        connectToSocket();
      } else {
        showError("First-time login failed. Please check your credentials.");
      }
    } catch (error) {
      console.error("Error:", error);
      showError("An error occurred during login");
    }
  });

// Update the showError function to handle different contexts
function showError(message, context = "form") {
  const errorDiv = document.createElement("div");
  errorDiv.className = "error-message";
  errorDiv.textContent = message;

  let container;
  switch (context) {
    case "chat":
      container = document.getElementById("messagesContainer");
      break;
    case "room":
      container = document.getElementById("roomMessagesContainer");
      break;
    default:
      container = document.querySelector('form[style="display: block;"]');
  }

  if (container) {
    container.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
  } else {
    console.error(message); // Fallback to console if no container found
  }
}

function logout() {
  localStorage.removeItem("jwt");
  localStorage.removeItem("username");
  localStorage.removeItem("userRole");
  currentUserId = null;

  document.getElementById("loginSection").style.display = "block";
  document.getElementById("homePage").style.display = "none";
  document.getElementById("adminSection").style.display = "none";
  document.getElementById("registrationSuccess").style.display = "none";

  document.getElementById("loginForm").reset();
  document.getElementById("adminRegisterForm")?.reset();

  // Disconnect socket
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

document
  .getElementById("adminRegisterForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const apiKey = localStorage.getItem("apiKey");
    const jwt = localStorage.getItem("jwt");

    if (!apiKey || !jwt) {
      alert("Missing API Key or not logged in");
      return;
    }

    const userData = {
      username: document.getElementById("newUsername").value,
      email: document.getElementById("newEmail").value,
    };

    try {
      const response = await fetch(
        "https://chatapp-backend-api-production.up.railway.app/api/registerUser",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            Authorization: jwt,
          },
          body: JSON.stringify(userData),
        }
      );

      if (response.ok) {
        const data = await response.json();

        // Display success message
        document.getElementById("createdUsername").textContent =
          userData.username;
        document.getElementById("createdEmail").textContent = userData.email;
        document.getElementById("setupToken").value = data.user.oneTimeToken;

        // Hide form and show success message
        document.getElementById("adminRegisterForm").style.display = "none";
        document.getElementById("registrationSuccess").style.display = "block";

        // Reset form for future use
        document.getElementById("adminRegisterForm").reset();

        const backButton = document.createElement("button");
        backButton.textContent = "Back to Home";
        backButton.onclick = backToHome;
        document.getElementById("registrationSuccess").appendChild(backButton);
      } else {
        const errorDiv = document.createElement("div");
        errorDiv.className = "error-message";
        errorDiv.textContent = "Registration failed. Please try again.";
        document.getElementById("adminRegisterForm").appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Registration failed!");
    }
  });

// Add copy token functionality
document
  .getElementById("copyTokenButton")
  .addEventListener("click", async () => {
    const tokenInput = document.getElementById("setupToken");
    await navigator.clipboard.writeText(tokenInput.value);

    const copyBtn = document.getElementById("copyTokenButton");
    copyBtn.classList.add("copied");
    copyBtn.textContent = "Copied!";

    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.textContent = "Copy Token";
    }, 2000);
  });

// Add button to return to registration form
function backToRegistration() {
  document.getElementById("registrationSuccess").style.display = "none";
  document.getElementById("adminRegisterForm").style.display = "block";
}

function showRegisterForm() {
  // Hide dashboard section
  document.querySelector(".dashboard-section").style.display = "none";
  // Show admin section
  document.getElementById("adminSection").style.display = "block";
}

function backToHome() {
  // Show dashboard section
  document.querySelector(".dashboard-section").style.display = "block";
  // Hide admin section
  document.getElementById("adminSection").style.display = "none";
  // Hide registration success message if visible
  document.getElementById("registrationSuccess").style.display = "none";
}

// Add this after your existing event listeners
document
  .getElementById("createRoomForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const apiKey = localStorage.getItem("apiKey");
    const jwt = localStorage.getItem("jwt");

    if (!apiKey || !jwt) {
      showError("Missing API Key or not logged in");
      return;
    }

    const roomData = {
      name: document.getElementById("roomName").value,
      type: document.getElementById("roomType").value,
    };

    try {
      const response = await fetch(
        "https://chatapp-backend-api-production.up.railway.app/api/createRoom",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            Authorization: jwt,
          },
          body: JSON.stringify(roomData),
        }
      );

      if (response.ok) {
        const data = await response.json();
        document.getElementById("createRoomForm").reset();
        // You can add functionality here to display the newly created room
        showSuccess("Room created successfully!");
        // Optionally refresh the rooms list
        await loadRooms();
      } else {
        const error = await response.json();
        showError(error.message || "Failed to create room");
      }
    } catch (error) {
      console.error("Error:", error);
      showError("An error occurred while creating the room");
    }
  });

function showSuccess(message) {
  const successDiv = document.createElement("div");
  successDiv.className = "success-message";
  successDiv.textContent = message;
  const form = document.getElementById("createRoomForm");
  form.appendChild(successDiv);
  setTimeout(() => successDiv.remove(), 3000);
}

// Add socket cleanup on window close
window.addEventListener("beforeunload", () => {
  if (socket) {
    socket.disconnect();
  }
});

function joinRoom(roomId) {
  socket.emit("room:join", { roomId });
}

function leaveRoom() {
  if (currentRoomId) {
    socket.emit("room:leave", { roomId: currentRoomId });
  }
}

// Fix the showRoomChat function
async function showRoomChat(roomName) {
  document.getElementById("roomsList").style.display = "none";
  document.getElementById("roomChatInterface").style.display = "block";
  document.getElementById("roomName").textContent = roomName;

  // Clear existing messages
  const messagesContainer = document.getElementById("roomMessagesContainer");
  messagesContainer.innerHTML =
    '<div class="loading-messages">Loading messages...</div>';

  try {
    // Load message history using currentRoomId
    const messages = await loadMessageHistory({
      roomId: currentRoomId,
    });

    // Clear loading message
    messagesContainer.innerHTML = "";

    // Display messages in chronological order
    messages.reverse().forEach((message) => {
      const isSentByMe = message.senderId._id === currentUserId;
      const type = isSentByMe ? "sent" : "received";
      const senderName = isSentByMe ? "" : message.senderId.username;
      addMessageToRoom(message.content, type, senderName);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (error) {
    console.error("Error:", error);
    messagesContainer.innerHTML =
      '<div class="error-message">Failed to load messages</div>';
  }
}

function hideRoomChat() {
  document.getElementById("roomsList").style.display = "block";
  document.getElementById("roomChatInterface").style.display = "none";
}

function addMessageToRoom(content, type, senderName = "") {
  const messagesContainer = document.getElementById("roomMessagesContainer");
  const messageElement = document.createElement("div");
  messageElement.className = `message ${type}`;

  if (type === "received") {
    messageElement.innerHTML = `<span class="sender-name">${senderName}:</span> ${content}`;
  } else {
    messageElement.textContent = content;
  }

  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add room message form handler
document
  .getElementById("roomMessageForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentRoomId) return;

    const messageInput = document.getElementById("roomMessageInput");
    const content = messageInput.value.trim();

    if (!content) return;

    // Add message to UI immediately
    addMessageToRoom(content, "sent");

    // Send message through socket
    socket.emit("message:room:send", {
      roomId: currentRoomId,
      content: content,
    });

    messageInput.value = "";
  });

// Update the loadMessageHistory function error handling
async function loadMessageHistory(params) {
  const apiKey = localStorage.getItem("apiKey");
  const jwt = localStorage.getItem("jwt");

  if (!apiKey || !jwt) return [];

  try {
    const queryParams = new URLSearchParams(params).toString();
    const response = await fetch(
      `https://chatapp-backend-api-production.up.railway.app/api/getMessages?${queryParams}`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          Authorization: jwt,
        },
      }
    );

    if (response.ok) {
      const messages = await response.json();
      return messages;
    } else {
      console.error("Failed to load message history");
      return [];
    }
  } catch (error) {
    console.error("Error loading messages:", error);
    return [];
  }
}

// Add new function to load all users
async function loadAllUsers() {
  const apiKey = localStorage.getItem("apiKey");
  const jwt = localStorage.getItem("jwt");

  if (!apiKey || !jwt) return;

  try {
    const response = await fetch(
      "https://chatapp-backend-api-production.up.railway.app/api/getUsers",
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          Authorization: jwt,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      console.log(data.users, Array.isArray(data.users));

      if (data.users && Array.isArray(data.users)) {
        updateUsersList(data.users);
      } else {
        console.error("Invalid users data format:", data);
      }
    }
  } catch (error) {
    console.error("Error loading users:", error);
  }
}

// Update updateUsersList function
function updateUsersList(users) {
  const usersList = document.getElementById("usersList"); // Changed ID
  usersList.innerHTML = ""; // Clear existing users

  if (!Array.isArray(users)) {
    console.error("Users is not an array:", users);
    return;
  }

  users
    .filter((user) => user._id !== currentUserId) // Filter out current user
    .forEach((user) => {
      console.log("User:", user);
      const userElement = document.createElement("div");
      userElement.className = "user-item";
      userElement.setAttribute("data-user-id", user._id);
      userElement.innerHTML = `
              <div class="user-status"></div>
              <div class="user-info">
                  <div class="user-name">${
                    user.username || "Unknown User"
                  }</div>
              </div>
          `;
      userElement.addEventListener("click", () => openChatInterface(user));
      usersList.appendChild(userElement);
    });
}

// Add these functions for invitation handling
function showInviteModal() {
  const modal = document.getElementById("inviteModal");
  const userSelection = modal.querySelector(".user-selection");
  const currentRoomName = document.getElementById("roomName").textContent;

  // Clear previous selections
  userSelection.innerHTML = "";

  // Get all users and create checkboxes
  const allUsers = Array.from(
    document.querySelectorAll("#usersList .user-item")
  ).map((item) => ({
    id: item.getAttribute("data-user-id"),
    username: item.querySelector(".user-name").textContent,
  }));

  allUsers.forEach((user) => {
    const checkbox = document.createElement("div");
    checkbox.className = "user-checkbox-item";
    checkbox.innerHTML = `
          <input type="checkbox" id="user-${user.id}" value="${user.username}">
          <label for="user-${user.id}">${user.username}</label>
      `;
    userSelection.appendChild(checkbox);
  });

  modal.style.display = "block";
}

function closeInviteModal() {
  document.getElementById("inviteModal").style.display = "none";
}

async function sendInvites() {
  const roomName = document.getElementById("roomName").textContent;
  const selectedUsers = Array.from(
    document.querySelectorAll(".user-checkbox-item input:checked")
  ).map((checkbox) => checkbox.value);

  console.log(
    JSON.stringify({
      roomName: roomName,
      invitedusers: selectedUsers,
    })
  );
  if (selectedUsers.length === 0) {
    showError("Please select at least one user to invite");
    return;
  }

  try {
    const response = await fetch(
      "https://chatapp-backend-api-production.up.railway.app/api/inviteUser",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": localStorage.getItem("apiKey"),
          Authorization: localStorage.getItem("jwt"),
        },
        body: JSON.stringify({
          roomName: roomName,
          invitedusers: selectedUsers,
        }),
      }
    );

    if (response.ok) {
      showSuccess("Invitations sent successfully!");
      closeInviteModal();
    } else {
      const error = await response.json();
      showError(error.message || "Failed to send invites");
    }
  } catch (error) {
    console.error("Error:", error);
    showError("Failed to send invites");
  }
}
