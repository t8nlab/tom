import t from "@titanpl/route";

// Health check
t.get("/").reply("Titan Planet Engine is running! ⏣");

// User Management Routes
t.get("/u/:id").action("user_actions");
t.get("/users").action("getuser");

t.start(5100, "Titan Server started on port 5100");

