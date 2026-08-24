<template>
  <UserList :users="users" />
</template>

<script setup lang="ts">
import { loadUsers } from "../services/users";

const users = loadUsers();
</script>
