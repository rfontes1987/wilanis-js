# Security

## Supported versions

Nothing is released yet. `main` is the only supported branch, and until 1.0 there are no published packages
to patch. Once 1.0 is cut, this section says which versions receive fixes.

## Reporting a vulnerability

Report it privately, not as an issue:

- **Preferred:** the repository's *Security* tab, *Report a vulnerability*. This opens a private advisory
  only the maintainers can read.
- **Or:** rfontes1987@gmail.com.

Please include what you found, the tree or the command that shows it, and what an attacker gets. A proof of
concept helps and is never required.

You can expect an acknowledgement, and then either a fix with an advisory or an explanation of why the
behaviour is intended. No date is promised: this is one maintainer, and a deadline that cannot be kept is
worse than none. A report that holds is worked on ahead of everything else. Tell us how you would like to be
credited, or that you would rather not be.

## Before you report

Two things look like findings and are not:

- **A plugin is arbitrary code.** The checker judges documents and how they compose; it never judges what a
  handler does once called. A plugin that misbehaves is a bug in that plugin.
- **The directories are fixtures.** `example/connections/` and `libraries/access/connections/` hold the
  development identities the trees sign in against: scrypt hashes in `settings`, and the cleartext passwords
  in each file's `description`, so the trees can be checked, rehearsed and run on their own. A production
  profile binds the same port to a real directory.

## The security model

What the toolchain guarantees, what it enforces and what is left to the application is being written as a
page of its own, under [RFC 0020](docs/rfcs/0020-security-model.md) and issue
[#310](https://github.com/wilanis/wilanis-js/issues/310).
