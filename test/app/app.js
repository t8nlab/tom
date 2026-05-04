import t from "@titanpl/route";


// User Management Routes
t.get("/").action("getuser");
t.get("/signup").action("auth_test");

t.start(5100, "Titan Server started on port 5100");

